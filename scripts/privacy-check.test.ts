import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error JavaScript production module intentionally has no declaration file.
import { scanContent, scanRepositoryPrivacy } from "./lib/privacy-check.mjs";

const roots: string[] = [];

function repository() {
  const root = mkdtempSync(path.join(os.tmpdir(), "jobtracker-privacy-"));
  roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "example@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Example Author"], { cwd: root });
  return root;
}

function commit(root: string, filename: string, contents: string) {
  const target = path.join(root, filename);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
  execFileSync("git", ["add", filename], { cwd: root });
  execFileSync("git", ["commit", "-qm", `add ${filename}`], { cwd: root });
}

afterEach(() => {
  for (const root of roots.splice(0)) execFileSync("rm", ["-rf", root]);
});

describe("repository privacy scanning", () => {
  it.each([
    ["macOS home", ["/", "Users", "/private-account/Documents/project"].join("")],
    ["Linux home", ["/", "home", "/private-account/resume.pdf"].join("")],
    ["Windows home", ["C:\\", "Users", "\\private-account\\resume.pdf"].join("")],
    ["controller state", [".co", "dex/orchestration/run/report.md"].join("")],
    ["worktree state", [".work", "trees/private-feature/file.ts"].join("")],
    ["desktop path", ["<user-home>/Desk", "top/private.png"].join("")]
  ])("flags %s", (_label, contents) => {
    expect(scanContent("docs/example.md", contents)).not.toEqual([]);
  });

  it.each(["Private City", "Private/Timezone", "Private Employer", "Taylor Resume.pdf"])("flags local denylist term %s", (term) => {
    expect(scanContent("docs/example.md", `Configured value: ${term}`, {
      privateTerms: ["Private City", "Private/Timezone", "Private Employer", "Taylor Resume.pdf"]
    })).not.toEqual([]);
  });

  it("allows placeholders, repository identity, license attribution, and fictional fixtures", () => {
    const contents = [
      "Use <project-root> and <user-home> placeholders.",
      "https://github.com/arovillard/job-application-tracker",
      "Copyright Alejandro Rovillard",
      "Example Candidate Resume.pdf",
      "Example City, Example Region"
    ].join("\n");
    expect(scanContent("README.md", contents)).toEqual([]);
  });

  it.each([
    ".env.local",
    "data/jobtracker.sqlite",
    "data/jobtracker.sqlite-wal",
    "data/job-discovery.json",
    "data/privacy-denylist.txt",
    "applications/Example Company/resume.pdf"
  ])("flags tracked private state at %s", (filename) => {
    const root = repository();
    commit(root, filename, "private");
    const result = scanRepositoryPrivacy(root);
    expect(result.findings.some((finding: { path: string }) => finding.path === filename)).toBe(true);
  });

  it("passes a clean current tree", () => {
    const root = repository();
    commit(root, "README.md", "Use <project-root>. Example Candidate lives in Example City.\n");
    expect(scanRepositoryPrivacy(root)).toMatchObject({ ok: true, findings: [] });
  });

  it("checks nonignored untracked files before they are staged", () => {
    const root = repository();
    const filename = path.join(root, "draft.md");
    writeFileSync(filename, ["Local path: /", "Users", "/private-account/project\n"].join(""));
    expect(scanRepositoryPrivacy(root).ok).toBe(false);
  });

  it("checks filenames against the local denylist", () => {
    const root = repository();
    commit(root, "docs/Private City notes.md", "Use private local configuration.\n");
    const result = scanRepositoryPrivacy(root, { privateTerms: ["Private City"] });
    expect(result.findings).toContainEqual(expect.objectContaining({
      path: "docs/Private City notes.md",
      rule: "private_denylist_term"
    }));
  });

  it("loads an ignored local denylist without committing its terms", () => {
    const root = repository();
    mkdirSync(path.join(root, "data"), { recursive: true });
    writeFileSync(path.join(root, "data", "privacy-denylist.txt"), "Private City\n");
    commit(root, "README.md", "Candidates in Private City configure this locally.\n");
    expect(scanRepositoryPrivacy(root).ok).toBe(false);
  });

  it("finds content removed from the current tree when history mode is enabled", () => {
    const root = repository();
    commit(root, "docs/old.md", ["Old path: /", "Users", "/private-account/project\n"].join(""));
    writeFileSync(path.join(root, "docs/old.md"), "Use <project-root>.\n");
    execFileSync("git", ["add", "docs/old.md"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "sanitize"], { cwd: root });

    expect(scanRepositoryPrivacy(root).ok).toBe(true);
    const history = scanRepositoryPrivacy(root, { history: true });
    expect(history.ok).toBe(false);
    expect(history.findings.some((finding: { ref?: string }) => Boolean(finding.ref))).toBe(true);
  });

  it("checks historical commit messages against the local denylist", () => {
    const root = repository();
    writeFileSync(path.join(root, "README.md"), "Use private local configuration.\n");
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "remove Private City path"], { cwd: root });

    const history = scanRepositoryPrivacy(root, { history: true, privateTerms: ["Private City"] });
    expect(history.findings).toContainEqual(expect.objectContaining({
      path: "<commit-message>",
      rule: "private_denylist_term"
    }));
  });
});
