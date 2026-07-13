import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
let tempDir: string; let dbPath: string; let applicationsDir: string;
function run(args = ["--db", dbPath]) { return JSON.parse(execFileSync(process.execPath, ["scripts/backfill-application-artifacts.mjs", ...args, "--applications-dir", applicationsDir], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as { registered: number; removedMissing: number; skipped: Array<{ reason: string }> }; }
beforeEach(() => { tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-backfill-")); dbPath = path.join(tempDir, "test.sqlite"); applicationsDir = path.join(tempDir, "applications"); const db = new Database(dbPath); db.exec("CREATE TABLE opportunities (id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, organization TEXT, status TEXT NOT NULL, priority TEXT NOT NULL, summary TEXT, origin_opportunity_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE job_opportunity_details (opportunity_id TEXT PRIMARY KEY, url TEXT, source TEXT, location TEXT, contact TEXT, applied_date TEXT);"); db.prepare("INSERT INTO opportunities VALUES ('job-id', 'job', 'Frontend Engineer', 'Acme', 'wishlist', 'medium', NULL, NULL, ?, ?)").run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"); db.prepare("INSERT INTO job_opportunity_details VALUES ('job-id', NULL, NULL, NULL, NULL, NULL)").run(); db.close(); });
afterEach(() => { rmSync(tempDir, { force: true, recursive: true }); });
describe("backfill-application-artifacts CLI", () => {
  it("backfills matching files into opportunity artifacts idempotently", () => { const dir = path.join(applicationsDir, "Acme"); mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, "frontend-engineer-fit-analysis.md"), "# Fit"); writeFileSync(path.join(dir, "Example Candidate Resume.pdf"), "pdf"); expect(run()).toMatchObject({ registered: 2, skipped: [] }); expect(run()).toMatchObject({ registered: 2 }); const db = new Database(dbPath); try { expect(db.prepare("SELECT COUNT(*) AS count FROM opportunity_artifacts WHERE opportunity_id = 'job-id'").get()).toEqual({ count: 2 }); } finally { db.close(); } });
  it("removes missing artifact links before registering moved files", () => {
    const dir = path.join(applicationsDir, "Acme");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "frontend-engineer-resume.pdf"), "new path");
    const db = new Database(dbPath);
    try {
      db.exec("CREATE TABLE opportunity_artifacts (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, file_path TEXT NOT NULL, content_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(opportunity_id, type, file_path), FOREIGN KEY(opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE)");
      db.prepare("INSERT INTO opportunity_artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("old", "job-id", "resume", "Old Resume", path.join(tempDir, "old-applications", "Acme", "frontend-engineer-resume.pdf"), "application/pdf", "2026-01-01", "2026-01-01");
    } finally { db.close(); }
    expect(run()).toMatchObject({ removedMissing: 1, registered: 1 });
    const verified = new Database(dbPath);
    try {
      expect(verified.prepare("SELECT file_path FROM opportunity_artifacts").all())
        .toEqual([{ file_path: path.join(dir, "frontend-engineer-resume.pdf") }]);
    } finally { verified.close(); }
  });
  it("preserves existing artifacts outside the applications directory", () => {
    mkdirSync(applicationsDir, { recursive: true });
    const externalDir = path.join(tempDir, "external-materials");
    const externalFile = path.join(externalDir, "frontend-engineer-cover-letter.pdf");
    mkdirSync(externalDir, { recursive: true });
    writeFileSync(externalFile, "cover letter");
    const db = new Database(dbPath);
    try {
      db.exec("CREATE TABLE opportunity_artifacts (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, file_path TEXT NOT NULL, content_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(opportunity_id, type, file_path), FOREIGN KEY(opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE)");
      db.prepare("INSERT INTO opportunity_artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("cover", "job-id", "cover_letter", "Cover Letter", externalFile, "application/pdf", "2026-01-01", "2026-01-01");
    } finally { db.close(); }
    expect(run()).toMatchObject({ removedMissing: 0, registered: 0 });
    const verified = new Database(dbPath);
    try {
      expect(verified.prepare("SELECT id, type, file_path FROM opportunity_artifacts").all())
        .toEqual([{ id: "cover", type: "cover_letter", file_path: externalFile }]);
    } finally { verified.close(); }
  });
  it("rolls back stale-link deletion when registration fails", () => {
    const dir = path.join(applicationsDir, "Acme");
    const movedFile = path.join(dir, "frontend-engineer-resume.pdf");
    const staleFile = path.join(tempDir, "old-applications", "Acme", "frontend-engineer-resume.pdf");
    mkdirSync(dir, { recursive: true });
    writeFileSync(movedFile, "new path");
    const db = new Database(dbPath);
    try {
      db.exec("CREATE TABLE opportunity_artifacts (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, file_path TEXT NOT NULL, content_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(opportunity_id, type, file_path), FOREIGN KEY(opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE)");
      db.prepare("INSERT INTO opportunity_artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("old", "job-id", "resume", "Old Resume", staleFile, "application/pdf", "2026-01-01", "2026-01-01");
      db.exec("CREATE TRIGGER fail_artifact_insert BEFORE INSERT ON opportunity_artifacts BEGIN SELECT RAISE(FAIL, 'forced registration failure'); END");
    } finally { db.close(); }
    expect(() => run()).toThrow(/forced registration failure/);
    const verified = new Database(dbPath);
    try {
      expect(verified.prepare("SELECT id, file_path FROM opportunity_artifacts").all())
        .toEqual([{ id: "old", file_path: staleFile }]);
    } finally { verified.close(); }
  });
  it("migrates an unmigrated legacy database and resolves JOBTRACKER_DB_PATH", () => { const db = new Database(dbPath); try { db.exec("DROP TABLE job_opportunity_details; DROP TABLE opportunities; CREATE TABLE applications (id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, source TEXT, location TEXT, url TEXT, contact TEXT, notes TEXT, applied_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);"); db.prepare("INSERT INTO applications VALUES ('legacy-job', 'Acme', 'Engineer', 'wishlist', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)").run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"); } finally { db.close(); } const dir = path.join(applicationsDir, "Acme"); mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, "legacy-fit-analysis.md"), "# Fit"); const previous = process.env.JOBTRACKER_DB_PATH; process.env.JOBTRACKER_DB_PATH = dbPath; try { expect(run([])).toMatchObject({ registered: 1 }); } finally { if (previous === undefined) delete process.env.JOBTRACKER_DB_PATH; else process.env.JOBTRACKER_DB_PATH = previous; } const migrated = new Database(dbPath); migrated.pragma("foreign_keys = ON"); try { for (const table of ["job_opportunity_details", "opportunity_activities", "opportunity_tasks", "opportunity_artifacts"]) expect(migrated.prepare(`PRAGMA foreign_key_list(${table})`).all()).toEqual(expect.arrayContaining([expect.objectContaining({ table: "opportunities", on_delete: "CASCADE" })])); expect(migrated.prepare("PRAGMA foreign_key_list(opportunity_tasks)").all()).toEqual(expect.arrayContaining([expect.objectContaining({ table: "opportunity_activities", on_delete: "SET NULL" })])); migrated.prepare("DELETE FROM opportunities WHERE id='legacy-job'").run(); for (const table of ["job_opportunity_details", "opportunity_activities", "opportunity_tasks", "opportunity_artifacts"]) expect(migrated.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE opportunity_id='legacy-job'`).get()).toEqual({ count: 0 }); } finally { migrated.close(); } });
});
