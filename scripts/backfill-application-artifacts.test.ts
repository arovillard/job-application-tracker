import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ApplicationInput } from "../src/types";
import { createApplication, getApplicationDetail, resetStorageForTests } from "../src/lib/storage";

let tempDir: string;
let dbPath: string;
let applicationsDir: string;

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

function runBackfill(args: string[] = []) {
  const output = execFileSync(process.execPath, ["scripts/backfill-application-artifacts.mjs", ...args], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8"
  });

  return JSON.parse(output) as {
    scannedFiles: number;
    registered: number;
    skipped: Array<{ reason: string; path: string }>;
  };
}

function countArtifacts() {
  const db = new Database(dbPath);
  try {
    return (db.prepare("SELECT COUNT(*) AS count FROM application_artifacts").get() as { count: number })
      .count;
  } finally {
    db.close();
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-backfill-"));
  dbPath = path.join(tempDir, "test.sqlite");
  applicationsDir = path.join(tempDir, "applications");
  process.env.JOBTRACKER_DB_PATH = dbPath;
});

afterEach(() => {
  resetStorageForTests();
  delete process.env.JOBTRACKER_DB_PATH;
  rmSync(tempDir, { force: true, recursive: true });
});

describe("backfill-application-artifacts CLI", () => {
  it("registers existing files for matching company folders and is idempotent", () => {
    const acme = createApplication(baseInput);
    createApplication({ ...baseInput, company: "No Folder Co", role: "Engineering Manager" });
    resetStorageForTests();

    const acmeDir = path.join(applicationsDir, "Acme");
    const unknownDir = path.join(applicationsDir, "Unknown Co");
    mkdirSync(acmeDir, { recursive: true });
    mkdirSync(unknownDir, { recursive: true });
    writeFileSync(path.join(acmeDir, "frontend-engineer-fit-analysis.md"), "# Fit\n");
    writeFileSync(path.join(acmeDir, "reach-out-message.md"), "# Outreach\n");
    writeFileSync(path.join(acmeDir, "Example Candidate Resume.pdf"), "pdf");
    writeFileSync(path.join(acmeDir, "Acme Jobs.pdf"), "pdf");
    writeFileSync(path.join(unknownDir, "unknown-fit-analysis.md"), "# Unknown\n");

    const result = runBackfill(["--db", dbPath, "--applications-dir", applicationsDir]);

    expect(result).toMatchObject({
      scannedFiles: 5,
      registered: 4
    });
    expect(result.skipped).toEqual([
      expect.objectContaining({
        reason: "no_matching_application",
        path: path.join(unknownDir, "unknown-fit-analysis.md")
      })
    ]);
    expect(getApplicationDetail(acme.id)?.artifacts.map((artifact) => artifact.type).sort()).toEqual([
      "fit_analysis",
      "outreach_message",
      "posting",
      "resume"
    ]);

    const secondRun = runBackfill(["--db", dbPath, "--applications-dir", applicationsDir]);

    expect(secondRun.registered).toBe(4);
    expect(countArtifacts()).toBe(4);
  });
});
