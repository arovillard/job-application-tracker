import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error JavaScript production module intentionally has no declaration file.
import { updateApplicationConfig, updateSetupConfig } from "./lib/application-readiness.mjs";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "jobtracker-config-"));
  roots.push(root);
  mkdirSync(path.join(root, "data"));
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) execFileSync("rm", ["-rf", root]);
});

describe("updateApplicationConfig", () => {
  it("preserves unrelated values and makes Google Docs the sole resume source", () => {
    const root = fixture();
    writeFileSync(path.join(root, ".env.local"), [
      "# keep this comment",
      'JOBTRACKER_DB_PATH="/tmp/jobs.sqlite"',
      'JOBTRACKER_BASE_RESUME_PATH="/tmp/resume.docx"',
      'UNRELATED_SETTING="keep-me"'
    ].join("\n"));
    const result = updateApplicationConfig(root, {
      baseResumeUrl: "https://docs.google.com/document/d/document-id/edit"
    });
    const written = readFileSync(path.join(root, ".env.local"), "utf8");
    expect(written).toContain("# keep this comment");
    expect(written).toContain('UNRELATED_SETTING="keep-me"');
    expect(written).toContain('JOBTRACKER_BASE_RESUME_PATH=""');
    expect(result.resume).toEqual({ kind: "google_doc", configured: true, location: "https://docs.google.com/document/d/document-id" });
    expect(JSON.stringify(result)).not.toContain("keep-me");
  });

  it("collapses duplicate managed keys so stale values cannot override an update", () => {
    const root = fixture();
    writeFileSync(path.join(root, ".env.local"), [
      'JOBTRACKER_LINKEDIN_URL="https://example.com/old-one"',
      'JOBTRACKER_LINKEDIN_URL="https://example.com/old-two"'
    ].join("\n"));
    updateApplicationConfig(root, { profileUrl: "https://example.com/new" });
    const matches = readFileSync(path.join(root, ".env.local"), "utf8").match(/JOBTRACKER_LINKEDIN_URL=/g);
    expect(matches).toHaveLength(1);
  });

  it("rejects unknown and invalid values before writing", () => {
    const root = fixture();
    expect(() => updateApplicationConfig(root, { apiKey: "secret" } as never)).toThrow(/unsupported configuration key/i);
    expect(() => updateApplicationConfig(root, { baseResumeUrl: "https://example.com/resume" })).toThrow(/Google Docs document URL/i);
    expect(existsSync(path.join(root, ".env.local"))).toBe(false);
  });

  it("rejects two sources and clears both when both are explicitly empty", () => {
    const root = fixture();
    expect(() => updateApplicationConfig(root, {
      baseResumeUrl: "https://docs.google.com/document/d/id/edit",
      baseResumePath: "/tmp/resume.docx"
    })).toThrow(/one resume source/i);
    updateApplicationConfig(root, { baseResumeUrl: "", baseResumePath: "" });
    const written = readFileSync(path.join(root, ".env.local"), "utf8");
    expect(written).toContain('JOBTRACKER_BASE_RESUME_URL=""');
    expect(written).toContain('JOBTRACKER_BASE_RESUME_PATH=""');
  });

  it("creates mode 0600 and preserves stricter existing permissions", () => {
    const root = fixture();
    updateApplicationConfig(root, { profileUrl: "https://www.linkedin.com/in/example" });
    expect(statSync(path.join(root, ".env.local")).mode & 0o777).toBe(0o600);
    execFileSync("chmod", ["400", path.join(root, ".env.local")]);
    updateApplicationConfig(root, { profileUrl: "https://example.com/profile" });
    expect(statSync(path.join(root, ".env.local")).mode & 0o777).toBe(0o400);
  });

  it("cleans the temporary file and preserves the original after rename failure", () => {
    const root = fixture();
    writeFileSync(path.join(root, ".env.local"), "# original\n", { mode: 0o600 });
    expect(() => updateApplicationConfig(root, { profileUrl: "https://example.com/me" }, {
      rename: () => { throw new Error("injected rename failure"); }
    })).toThrow("injected rename failure");
    expect(readFileSync(path.join(root, ".env.local"), "utf8")).toBe("# original\n");
    expect(execFileSync("find", [root, "-maxdepth", "1", "-name", ".env.local.tmp-*"], { encoding: "utf8" })).toBe("");
  });

  it("allows trusted setup fields without expanding the agent allowlist", () => {
    const root = fixture();
    const summary = updateSetupConfig(root, {
      databasePath: "./data/custom.sqlite",
      providerNote: "Configured in host",
      applicationsDirectory: "./applications"
    });
    const written = readFileSync(path.join(root, ".env.local"), "utf8");
    expect(written).toContain('JOBTRACKER_DB_PATH="./data/custom.sqlite"');
    expect(written).toContain('JOBTRACKER_AI_PROVIDER="Configured in host"');
    expect(summary).not.toHaveProperty("providerNote");
    expect(() => updateApplicationConfig(root, { databasePath: "/tmp/other.sqlite" } as never)).toThrow(/unsupported configuration key/i);
  });
});

describe("configure CLI", () => {
  it("reads stdin and emits only a redacted summary", () => {
    const root = fixture();
    const script = path.resolve("scripts/configure-application-profile.mjs");
    const result = spawnSync(process.execPath, [script, "--project-root", root, "--input-json", "-"], {
      input: JSON.stringify({ baseResumeUrl: "https://docs.google.com/document/d/cli-id/edit" }),
      encoding: "utf8"
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ resume: { kind: "google_doc", configured: true } });
    expect(result.stdout).not.toContain("edit");
    expect(result.stderr).toBe("");
  });

  it("rejects malformed arguments and exits one", () => {
    const script = path.resolve("scripts/configure-application-profile.mjs");
    const result = spawnSync(process.execPath, [script, "--unknown"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/Unknown argument/);
  });
});
