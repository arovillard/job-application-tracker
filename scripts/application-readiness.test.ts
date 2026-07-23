import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error JavaScript production module intentionally has no declaration file.
import { evaluateApplicationReadiness, readApplicationConfig, validateApplicationsDirectoryPrivacy } from "./lib/application-readiness.mjs";

const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "jobtracker-readiness-"));
  roots.push(root);
  mkdirSync(path.join(root, "data"), { recursive: true });
  mkdirSync(path.join(root, "applications"), { recursive: true });
  writeFileSync(path.join(root, ".env.example"), "");
  writeFileSync(path.join(root, ".gitignore"), ".env.local\ndata/*.sqlite\napplications/*\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  for (const skill of ["daily-job-discovery-setup", "job-application-resume", "job-application-workflow", "job-tracker-add-posting"]) {
    for (const sourceRoot of ["skills", path.join(".claude", "skills")]) {
      const directory = path.join(root, sourceRoot, skill);
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, "SKILL.md"), `# ${skill}\n`);
    }
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    execFileSync("rm", ["-rf", root]);
  }
});

describe("readApplicationConfig", () => {
  it.each([undefined, ""])('defaults applications directory for %s', (configured) => {
    const root = fixture();
    if (configured !== undefined) {
      writeFileSync(path.join(root, ".env.local"), 'JOBTRACKER_APPLICATIONS_DIR=""\n');
    }
    expect(readApplicationConfig(root, {}).applicationsDirectory)
      .toBe(path.join(root, "applications"));
  });

  it("parses dotenv without evaluation and applies known environment overrides", () => {
    const root = fixture();
    writeFileSync(path.join(root, ".env.local"), [
      'JOBTRACKER_APPLICATIONS_DIR="./from-file"',
      'JOBTRACKER_BASE_RESUME_PATH="$(touch should-not-exist).docx"',
      'UNRELATED_SECRET="do-not-return"'
    ].join("\n"));

    const config = readApplicationConfig(root, {
      JOBTRACKER_APPLICATIONS_DIR: "./from-process",
      UNRELATED_SECRET: "also-secret"
    });

    expect(config.applicationsDirectory).toBe(path.join(root, "from-process"));
    expect(config.baseResumePath).toBe(path.join(root, "$(touch should-not-exist).docx"));
    expect(config).not.toHaveProperty("UNRELATED_SECRET");
  });
});

describe("validateApplicationsDirectoryPrivacy", () => {
  it("escapes Git glob metacharacters in the suggested exact ignore rule", () => {
    const root = fixture();

    expect(() => validateApplicationsDirectoryPrivacy(root, "./private[1]"))
      .toThrow('Add the exact rule "/private\\[1\\]/"');
  });

  it("rejects the repository root without suggesting an ineffective ignore rule", () => {
    const root = fixture();

    expect(() => validateApplicationsDirectoryPrivacy(root, "."))
      .toThrow(/repository root.*\.\/applications.*external absolute path/i);
  });
});

describe("evaluateApplicationReadiness", () => {
  it("needs input without a resume but only warns without a profile", () => {
    const root = fixture();
    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
    expect(result).toMatchObject({ schemaVersion: 1, status: "needs_input", projectRoot: root });
    expect(result.resume.kind).toBe("none");
    expect(result.blockingIssues).toContain("resume_missing");
    expect(result.applicationsDirectory).toEqual({ path: path.join(root, "applications"), exists: true, writable: true });
    expect(result.blockingIssues).not.toContain("applications_directory_unconfigured");
    expect(result.warnings).toContain("profile_missing");
  });

  it("prefers Google Docs and requires a host access check", () => {
    const root = fixture();
    writeFileSync(path.join(root, ".env.local"), [
      'JOBTRACKER_BASE_RESUME_URL="https://docs.google.com/document/d/document-id/edit"',
      'JOBTRACKER_BASE_RESUME_PATH="/tmp/older.docx"'
    ].join("\n"));
    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
    expect(result.resume).toMatchObject({
      kind: "google_doc",
      configured: true,
      locallyValid: true,
      requiresExternalAccessCheck: true,
      location: "https://docs.google.com/document/d/document-id"
    });
    expect(result.warnings).toContain("multiple_resume_sources");
  });

  it.each([
    ["resume.docx", "docx", undefined],
    ["resume.pdf", "pdf", "pdf_formatting_limited"],
    ["resume.md", "text", undefined],
    ["resume.txt", "text", undefined]
  ])("accepts %s as %s", (filename, kind, warning) => {
    const root = fixture();
    const resume = path.join(os.tmpdir(), `${path.basename(root)}-${filename}`);
    roots.push(resume);
    writeFileSync(resume, "private resume contents");
    writeFileSync(path.join(root, ".env.local"), `JOBTRACKER_BASE_RESUME_PATH="${resume}"\n`);
    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
    expect(result.resume).toMatchObject({ kind, configured: true, locallyValid: true });
    expect(result.resume).not.toHaveProperty("contents");
    expect(result.warnings.includes(String(warning))).toBe(Boolean(warning));
  });

  it.each([
    ["/missing/resume.docx", "resume_invalid"],
    ["/tmp/resume.rtf", "resume_invalid"]
  ])("needs input for invalid source %s", (resume, issue) => {
    const root = fixture();
    writeFileSync(path.join(root, ".env.local"), `JOBTRACKER_BASE_RESUME_PATH="${resume}"\n`);
    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
    expect(result.status).toBe("needs_input");
    expect(result.blockingIssues).toContain(issue);
  });

  it("blocks when an existing resume is unreadable", () => {
    const root = fixture();
    const resume = path.join(os.tmpdir(), `${path.basename(root)}-unreadable.docx`);
    roots.push(resume);
    writeFileSync(resume, "private resume contents", { mode: 0o000 });
    writeFileSync(path.join(root, ".env.local"), `JOBTRACKER_BASE_RESUME_PATH="${resume}"\n`);
    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues).toContain("resume_unreadable");
  });

  it("rejects a directory whose name has a supported resume extension", () => {
    const root = fixture();
    const resume = path.join(os.tmpdir(), `${path.basename(root)}-directory.docx`);
    roots.push(resume);
    mkdirSync(resume);
    writeFileSync(path.join(root, ".env.local"), `JOBTRACKER_BASE_RESUME_PATH="${resume}"\n`);
    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
    expect(result.status).toBe("needs_input");
    expect(result.blockingIssues).toContain("resume_invalid");
  });

  it("reports explicit destination and database writability", () => {
    const root = fixture();
    const resume = path.join(os.tmpdir(), `${path.basename(root)}-resume.docx`);
    roots.push(resume);
    writeFileSync(resume, "resume");
    writeFileSync(path.join(root, ".env.local"), [
      `JOBTRACKER_BASE_RESUME_PATH="${resume}"`,
      'JOBTRACKER_APPLICATIONS_DIR="./applications"',
      'JOBTRACKER_DB_PATH="./data/jobs.sqlite"'
    ].join("\n"));
    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
    expect(result.applicationsDirectory).toEqual({ path: path.join(root, "applications"), exists: true, writable: true });
    expect(result.database).toEqual({ path: path.join(root, "data", "jobs.sqlite"), parentExists: true, parentWritable: true });
  });

  it("defaults an explicitly empty applications directory", () => {
    const root = fixture();
    writeFileSync(path.join(root, ".env.local"), 'JOBTRACKER_APPLICATIONS_DIR=""\n');
    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
    expect(result.status).toBe("needs_input");
    expect(result.applicationsDirectory).toEqual({ path: path.join(root, "applications"), exists: true, writable: true });
    expect(result.blockingIssues).not.toContain("applications_directory_unconfigured");
  });

  it("blocks an ambiguous root applications directory", () => {
    const root = fixture();
    writeFileSync(path.join(root, ".env.local"), 'JOBTRACKER_APPLICATIONS_DIR="/applications"\n');
    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues).toContain("applications_directory_ambiguous");
    expect(result.blockingIssues).not.toContain("applications_directory_not_ignored");
  });

  it("blocks when the applications directory exists without write permission", () => {
    const root = fixture();
    const output = path.join(os.tmpdir(), `${path.basename(root)}-output`);
    roots.push(output);
    mkdirSync(output, { mode: 0o500 });
    writeFileSync(path.join(root, ".env.local"), `JOBTRACKER_APPLICATIONS_DIR="${output}"\n`);
    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues).toContain("applications_directory_unwritable");
  });

  it("blocks for incomplete repository skills and warns for isolated personal homes", () => {
    const root = fixture();
    execFileSync("rm", ["-rf", path.join(root, "skills", "job-application-workflow")]);
    const result = evaluateApplicationReadiness({
      projectRoot: root,
      processEnv: {},
      codexHome: path.join(root, "empty-codex"),
      claudeHome: path.join(root, "empty-claude")
    });
    expect(result.status).toBe("blocked");
    expect(result.skills).toEqual({ repositoryComplete: false, codexInstalled: false, claudeInstalled: false });
    expect(result.blockingIssues).toContain("skills_repository_incomplete");
    expect(result.warnings).toEqual(expect.arrayContaining(["codex_skills_not_installed", "claude_skills_not_installed"]));
  });

  it("warns separately when installed skills are stale", () => {
    const root = fixture();
    const codexHome = path.join(root, "codex-home");
    const claudeHome = path.join(root, "claude-home");
    for (const skill of ["daily-job-discovery-setup", "job-application-resume", "job-application-workflow", "job-tracker-add-posting"]) {
      const source = `# ${skill}\n`;
      for (const home of [codexHome, claudeHome]) {
        const directory = path.join(home, "skills", skill);
        mkdirSync(directory, { recursive: true });
        writeFileSync(path.join(directory, "SKILL.md"), source);
      }
    }
    writeFileSync(
      path.join(codexHome, "skills", "job-application-workflow", "SKILL.md"),
      "# stale workflow\n"
    );

    const result = evaluateApplicationReadiness({
      projectRoot: root,
      processEnv: {},
      codexHome,
      claudeHome
    });

    expect(result.skills).toEqual({ repositoryComplete: true, codexInstalled: true, claudeInstalled: true });
    expect(result.warnings).toContain("codex_skills_stale");
    expect(result.warnings).not.toContain("codex_skills_not_installed");
    expect(result.warnings).not.toContain("claude_skills_stale");
  });

  it("blocks unignored repository-local private paths", () => {
    const root = fixture();
    const resume = path.join(root, "private", "resume.docx");
    mkdirSync(path.dirname(resume), { recursive: true });
    writeFileSync(resume, "do not leak this phrase");
    mkdirSync(path.join(root, "custom-output"));
    writeFileSync(path.join(root, ".env.local"), [
      'JOBTRACKER_BASE_RESUME_PATH="./private/resume.docx"',
      'JOBTRACKER_APPLICATIONS_DIR="./custom-output"'
    ].join("\n"));
    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues).toEqual(expect.arrayContaining([
      "resume_path_not_ignored",
      "applications_directory_not_ignored"
    ]));
    expect(JSON.stringify(result)).not.toContain("do not leak this phrase");
  });

  it("blocks external symlink aliases that resolve to unignored repository paths", () => {
    const root = fixture();
    const resume = path.join(root, "private", "resume.docx");
    const output = path.join(root, "private-output");
    mkdirSync(path.dirname(resume), { recursive: true });
    mkdirSync(output);
    writeFileSync(resume, "resume");
    const resumeAlias = path.join(os.tmpdir(), `${path.basename(root)}-resume-alias.docx`);
    const outputAlias = path.join(os.tmpdir(), `${path.basename(root)}-output-alias`);
    roots.push(resumeAlias, outputAlias);
    symlinkSync(resume, resumeAlias);
    symlinkSync(output, outputAlias);
    writeFileSync(path.join(root, ".env.local"), [
      `JOBTRACKER_BASE_RESUME_PATH="${resumeAlias}"`,
      `JOBTRACKER_APPLICATIONS_DIR="${outputAlias}"`
    ].join("\n"));

    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });

    expect(result.status).toBe("blocked");
    expect(result.blockingIssues).toEqual(expect.arrayContaining([
      "resume_path_not_ignored",
      "applications_directory_not_ignored"
    ]));
  });

  it("allows repository symlink aliases that resolve to external private paths", () => {
    const root = fixture();
    const externalRoot = path.join(os.tmpdir(), `${path.basename(root)}-external-private`);
    const resume = path.join(externalRoot, "resume.docx");
    const output = path.join(externalRoot, "output");
    roots.push(externalRoot);
    mkdirSync(output, { recursive: true });
    writeFileSync(resume, "resume");
    const resumeAlias = path.join(root, "resume-alias.docx");
    const outputAlias = path.join(root, "output-alias");
    symlinkSync(resume, resumeAlias);
    symlinkSync(output, outputAlias);
    writeFileSync(path.join(root, ".env.local"), [
      'JOBTRACKER_BASE_RESUME_PATH="./resume-alias.docx"',
      'JOBTRACKER_APPLICATIONS_DIR="./output-alias"'
    ].join("\n"));

    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });

    expect(result.blockingIssues).not.toContain("resume_path_not_ignored");
    expect(result.blockingIssues).not.toContain("applications_directory_not_ignored");
  });

  it("does not treat a dotfile-only ignore rule as protection for application artifacts", () => {
    const root = fixture();
    const resume = path.join(os.tmpdir(), `${path.basename(root)}-resume.docx`);
    roots.push(resume);
    writeFileSync(resume, "resume");
    mkdirSync(path.join(root, "custom-output"));
    writeFileSync(path.join(root, ".gitignore"), [
      ".env.local",
      "custom-output/.*"
    ].join("\n"));
    writeFileSync(path.join(root, ".env.local"), [
      `JOBTRACKER_BASE_RESUME_PATH="${resume}"`,
      'JOBTRACKER_APPLICATIONS_DIR="./custom-output"'
    ].join("\n"));
    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues).toContain("applications_directory_not_ignored");
  });

  it("blocks an inaccessible resume parent instead of reporting a missing resume", () => {
    const root = fixture();
    const parent = path.join(os.tmpdir(), `${path.basename(root)}-resume-parent`);
    roots.push(parent);
    mkdirSync(parent);
    const resume = path.join(parent, "resume.docx");
    writeFileSync(resume, "resume");
    chmodSync(parent, 0o000);
    try {
      writeFileSync(path.join(root, ".env.local"), `JOBTRACKER_BASE_RESUME_PATH="${resume}"\n`);
      const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
      expect(result.status).toBe("blocked");
      expect(result.blockingIssues).toContain("resume_permission_denied");
      expect(result.blockingIssues).not.toContain("resume_invalid");
    } finally {
      chmodSync(parent, 0o700);
    }
  });

  it("blocks an inaccessible applications parent instead of reporting an unavailable directory", () => {
    const root = fixture();
    const parent = path.join(os.tmpdir(), `${path.basename(root)}-applications-parent`);
    roots.push(parent);
    const output = path.join(parent, "output");
    mkdirSync(output, { recursive: true });
    chmodSync(parent, 0o000);
    try {
      writeFileSync(path.join(root, ".env.local"), `JOBTRACKER_APPLICATIONS_DIR="${output}"\n`);
      const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
      expect(result.status).toBe("blocked");
      expect(result.blockingIssues).toContain("applications_directory_permission_denied");
      expect(result.blockingIssues).not.toContain("applications_directory_unavailable");
    } finally {
      chmodSync(parent, 0o700);
    }
  });

  it("reports a stable permission code for an inaccessible database parent", () => {
    const root = fixture();
    const parent = path.join(os.tmpdir(), `${path.basename(root)}-database-parent`);
    roots.push(parent);
    const databaseDirectory = path.join(parent, "data");
    mkdirSync(databaseDirectory, { recursive: true });
    chmodSync(parent, 0o000);
    try {
      writeFileSync(path.join(root, ".env.local"), `JOBTRACKER_DB_PATH="${path.join(databaseDirectory, "jobs.sqlite")}"\n`);
      const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
      expect(result.status).toBe("blocked");
      expect(result.blockingIssues).toContain("database_parent_permission_denied");
      expect(result.blockingIssues).not.toContain("database_parent_unavailable");
    } finally {
      chmodSync(parent, 0o700);
    }
  });

  it("treats a missing database parent as user-correctable input", () => {
    const root = fixture();
    writeFileSync(path.join(root, ".env.local"), [
      'JOBTRACKER_APPLICATIONS_DIR="./applications"',
      'JOBTRACKER_DB_PATH="./missing/data/jobs.sqlite"'
    ].join("\n"));
    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
    expect(result.status).toBe("needs_input");
    expect(result.blockingIssues).toContain("database_parent_unavailable");
  });

  it("blocks when an existing database parent is not writable", () => {
    const root = fixture();
    const databaseParent = path.join(os.tmpdir(), `${path.basename(root)}-readonly-database`);
    roots.push(databaseParent);
    mkdirSync(databaseParent, { mode: 0o500 });
    writeFileSync(path.join(root, ".env.local"), [
      'JOBTRACKER_APPLICATIONS_DIR="./applications"',
      `JOBTRACKER_DB_PATH="${path.join(databaseParent, "jobs.sqlite")}"`
    ].join("\n"));
    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues).toContain("database_parent_unwritable");
  });

  it("blocks unreadable configuration", () => {
    const root = fixture();
    writeFileSync(path.join(root, ".env.local"), "JOBTRACKER_BASE_RESUME_PATH=x");
    chmodSync(path.join(root, ".env.local"), 0o000);
    const result = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues).toContain("configuration_unreadable");
  });
});
