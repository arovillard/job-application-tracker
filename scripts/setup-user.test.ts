import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

// @ts-expect-error JavaScript production module intentionally has no declaration file.
import { buildResumeConfig, runSetup } from "./setup-user.mjs";

const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "jobtracker-setup-"));
  roots.push(root);
  return root;
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
