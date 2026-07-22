import { describe, expect, it } from "vitest";
import { commitJobDossier } from "./commit-job-dossier.mjs";
import { ensureOpportunitySchema } from "./lib/opportunity-schema.mjs";
import { acquireDailyJobPrepLock } from "./lib/daily-job-prep-lock.mjs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

describe("commitJobDossier", () => {
  it("is exported for guarded programmatic dossier commits", () => {
    expect(typeof commitJobDossier).toBe("function");
  });
  it("commits and registers five staged files for a new dossier", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dossier-commit-"));
    try {
      const dbPath = path.join(dir, "tracker.sqlite"), applications = path.join(dir, "applications"), staging = path.join(applications, ".staging"); mkdirSync(staging, { recursive: true });
      const db = new Database(dbPath); ensureOpportunitySchema(db); db.prepare("INSERT INTO opportunities VALUES ('job-id','job','Role','Acme','wishlist','medium',NULL,NULL,?,?)").run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"); db.prepare("INSERT INTO job_opportunity_details VALUES ('job-id',NULL,NULL,NULL,NULL,NULL)").run(); db.close();
      const lock = acquireDailyJobPrepLock(dbPath); const entries = ["resume", "fit_analysis", "cover_letter", "outreach_message", "submission_guide"].map((key) => { const stagedFile = path.join(staging, `${key}.md`), destinationFile = path.join(applications, `${key}.md`); writeFileSync(stagedFile, key); return { key, stagedFile, destinationFile, contentType: "text/markdown" }; });
      const result = commitJobDossier({ db: dbPath, "opportunity-id": "job-id", "applications-dir": applications, "lock-token": lock.token, "expected-status": "wishlist", "expected-updated-at": "2026-01-01T00:00:00.000Z", manifest: { schemaVersion: 1, entries } });
      expect(result.complete).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("rejects a staging root symlink that escapes applications before copying", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dossier-escape-"));
    try {
      const dbPath = path.join(dir, "tracker.sqlite"), applications = path.join(dir, "applications"), external = path.join(dir, "external"); mkdirSync(applications); mkdirSync(external);
      const db = new Database(dbPath); ensureOpportunitySchema(db); db.prepare("INSERT INTO opportunities VALUES ('job-id','job','Role','Acme','wishlist','medium',NULL,NULL,?,?)").run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"); db.prepare("INSERT INTO job_opportunity_details VALUES ('job-id',NULL,NULL,NULL,NULL,NULL)").run(); db.close();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:fs").symlinkSync(external, path.join(applications, ".staging")); const staged = path.join(external, "resume.md"); writeFileSync(staged, "resume"); const lock = acquireDailyJobPrepLock(dbPath);
      expect(() => commitJobDossier({ db: dbPath, "opportunity-id": "job-id", "applications-dir": applications, "lock-token": lock.token, "expected-status": "wishlist", "expected-updated-at": "2026-01-01T00:00:00.000Z", manifest: { schemaVersion: 1, entries: [] } })).toThrow(/staging/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
