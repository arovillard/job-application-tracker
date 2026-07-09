import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ApplicationInput } from "../src/types";
import { createApplication, getApplicationDetail, resetStorageForTests } from "../src/lib/storage";

let tempDir: string;
let dbPath: string;

const baseInput: ApplicationInput = {
  company: "Acme",
  role: "Frontend Engineer",
  status: "wishlist",
  source: "Company careers",
  location: "Remote",
  url: "https://example.com/jobs/frontend",
  contact: null,
  notes: "Frontend platform role",
  appliedDate: null,
  followUpDate: null
};

function runRegisterArtifact(args: string[]) {
  const output = execFileSync(process.execPath, ["scripts/register-application-artifact.mjs", ...args], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8"
  });

  return JSON.parse(output) as {
    action: string;
    artifact: {
      applicationId: string;
      type: string;
      title: string;
      filePath: string;
      contentType: string;
    };
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-artifact-cli-"));
  dbPath = path.join(tempDir, "test.sqlite");
  process.env.JOBTRACKER_DB_PATH = dbPath;
});

afterEach(() => {
  resetStorageForTests();
  delete process.env.JOBTRACKER_DB_PATH;
  rmSync(tempDir, { force: true, recursive: true });
});

describe("register-application-artifact CLI", () => {
  it("associates a Markdown artifact with an existing company and role", () => {
    const application = createApplication(baseInput);
    resetStorageForTests();
    const artifactDir = path.join(tempDir, "applications", "Acme");
    const artifactPath = path.join(artifactDir, "frontend-engineer-fit-analysis.md");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(artifactPath, "# Fit Analysis\n\nStrong React evidence.");

    const result = runRegisterArtifact([
      "--db",
      dbPath,
      "--company",
      "acme",
      "--role",
      "frontend engineer",
      "--type",
      "fit_analysis",
      "--title",
      "Fit Analysis",
      "--file",
      artifactPath
    ]);

    expect(result).toMatchObject({
      action: "registered",
      artifact: {
        applicationId: application.id,
        type: "fit_analysis",
        title: "Fit Analysis",
        filePath: artifactPath,
        contentType: "text/markdown"
      }
    });

    const detail = getApplicationDetail(application.id);
    expect(detail?.artifacts[0]).toEqual(
      expect.objectContaining({
        title: "Fit Analysis",
        content: expect.stringContaining("Strong React evidence.")
      })
    );
  });
});
