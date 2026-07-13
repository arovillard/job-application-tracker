import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

// @ts-expect-error JavaScript production module intentionally has no declaration file.
import { evaluateApplicationReadiness } from "./lib/application-readiness.mjs";
// @ts-expect-error JavaScript production module intentionally has no declaration file.
import { buildResumeConfig, runSetup } from "./setup-user.mjs";

const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "jobtracker-setup-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  writeFileSync(path.join(root, ".gitignore"), "applications/*\n");
  return root;
}

function ignoreDirectory(root: string, relativePath: string) {
  writeFileSync(path.join(root, ".gitignore"), `applications/*\n${relativePath.replace(/\/$/, "")}/\n`);
}

afterEach(() => {
  for (const root of roots.splice(0)) execFileSync("rm", ["-rf", root]);
});

it("prefers a Google Doc over a local file", () => {
  expect(buildResumeConfig({
    googleDocUrl: "https://docs.google.com/document/d/id/edit",
    localPath: "/tmp/resume.docx"
  })).toEqual({
    baseResumeUrl: "https://docs.google.com/document/d/id/edit",
    baseResumePath: ""
  });
});

it("falls back to a local file", () => {
  expect(buildResumeConfig({ googleDocUrl: "", localPath: "/tmp/resume.docx" }))
    .toEqual({ baseResumeUrl: "", baseResumePath: "/tmp/resume.docx" });
});

it("writes the complete trusted setup contract without exposing credential fields", async () => {
  const root = fixture();
  ignoreDirectory(root, "private-output");
  writeFileSync(path.join(root, ".env.local"), [
    "# keep this comment",
    'UNRELATED_SETTING="keep-me"',
    ""
  ].join("\n"));

  await runSetup({
    projectRoot: root,
    answers: {
      dbPath: path.join(root, "data", "custom.sqlite"),
      applicationsDir: path.join(root, "private-output"),
      googleDocUrl: "https://docs.google.com/document/d/id/edit",
      localPath: "",
      linkedInUrl: "https://www.linkedin.com/in/example",
      aiProvider: "Configured in host"
    },
    installSkills: false
  });

  const written = readFileSync(path.join(root, ".env.local"), "utf8");
  expect(written).toContain("# keep this comment");
  expect(written).toContain('UNRELATED_SETTING="keep-me"');
  expect(written).toContain(`JOBTRACKER_DB_PATH="${path.join(root, "data", "custom.sqlite")}"`);
  expect(written).toContain(`JOBTRACKER_APPLICATIONS_DIR="${path.join(root, "private-output")}"`);
  expect(written).toContain('JOBTRACKER_BASE_RESUME_URL="https://docs.google.com/document/d/id/edit"');
  expect(written).toContain('JOBTRACKER_BASE_RESUME_PATH=""');
  expect(written).toContain('JOBTRACKER_LINKEDIN_URL="https://www.linkedin.com/in/example"');
  expect(written).toContain('JOBTRACKER_AI_PROVIDER="Configured in host"');
  expect(written).not.toMatch(/API_KEY|TOKEN|SECRET/);
});

it("creates and stores the repository-local applications default", async () => {
  const root = fixture();
  await runSetup({
    projectRoot: root,
    answers: {
      dbPath: "./data/jobtracker.sqlite",
      applicationsDir: "applications",
      googleDocUrl: "",
      localPath: "",
      linkedInUrl: "",
      aiProvider: ""
    },
    installSkills: false
  });
  expect(existsSync(path.join(root, "applications"))).toBe(true);
  expect(readFileSync(path.join(root, ".env.local"), "utf8"))
    .toContain('JOBTRACKER_APPLICATIONS_DIR="./applications"');
});

it("creates an already ignored relative override that passes readiness privacy checks", async () => {
  const root = fixture();
  ignoreDirectory(root, "private-output");

  await runSetup({
    projectRoot: root,
    answers: {
      dbPath: "./data/jobtracker.sqlite",
      applicationsDir: "./private-output",
      googleDocUrl: "",
      localPath: "",
      linkedInUrl: "",
      aiProvider: ""
    },
    installSkills: false
  });

  expect(existsSync(path.join(root, "private-output"))).toBe(true);
  expect(readFileSync(path.join(root, ".env.local"), "utf8"))
    .toContain('JOBTRACKER_APPLICATIONS_DIR="./private-output"');
  const readiness = evaluateApplicationReadiness({ projectRoot: root, processEnv: {} });
  expect(readiness.applicationsDirectory.path).toBe(path.join(root, "private-output"));
  expect(readiness.blockingIssues).not.toContain("applications_directory_not_ignored");
});

it("rejects an unignored relative override before changing setup files", async () => {
  const root = fixture();

  await expect(runSetup({
    projectRoot: root,
    answers: {
      dbPath: "./data/jobtracker.sqlite",
      applicationsDir: "./private-output",
      googleDocUrl: "",
      localPath: "",
      linkedInUrl: "",
      aiProvider: ""
    },
    installSkills: false
  })).rejects.toThrow(/private-output\/.*\.gitignore.*external absolute path/i);

  expect(existsSync(path.join(root, ".env.local"))).toBe(false);
  expect(existsSync(path.join(root, "data"))).toBe(false);
  expect(existsSync(path.join(root, "private-output"))).toBe(false);
});

it("rejects /applications without changing setup files", async () => {
  const root = fixture();
  await expect(runSetup({
    projectRoot: root,
    answers: { dbPath: "./data/jobtracker.sqlite", applicationsDir: "/applications", googleDocUrl: "", localPath: "", linkedInUrl: "", aiProvider: "" },
    installSkills: false
  })).rejects.toThrow(/\.\/applications/);
  expect(existsSync(path.join(root, ".env.local"))).toBe(false);
  expect(existsSync(path.join(root, "data"))).toBe(false);
});
