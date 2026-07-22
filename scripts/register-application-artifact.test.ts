import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error JavaScript production module intentionally has no declaration file.
import { ensureOpportunitySchema } from "./lib/opportunity-schema.mjs";
// @ts-expect-error JavaScript production module intentionally has no declaration file.
import { acquireDailyJobPrepLock, LOCK_TTL_MS, releaseDailyJobPrepLock } from "./lib/daily-job-prep-lock.mjs";

let tempDir: string; let dbPath: string;
function run(args: string[]) { return JSON.parse(execFileSync(process.execPath, ["scripts/register-application-artifact.mjs", "--db", dbPath, ...args], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" })) as { action: string; opportunity: { id: string; type: string }; application: unknown; artifact: { opportunityId: string; applicationId: string } }; }
function job(id = "job-id") { const db = new Database(dbPath); try { db.exec("CREATE TABLE opportunities (id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, organization TEXT, status TEXT NOT NULL, priority TEXT NOT NULL, summary TEXT, origin_opportunity_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE job_opportunity_details (opportunity_id TEXT PRIMARY KEY, url TEXT, source TEXT, location TEXT, contact TEXT, applied_date TEXT);"); db.prepare("INSERT INTO opportunities VALUES (?, 'job', 'Frontend Engineer', 'Acme', 'wishlist', 'medium', NULL, NULL, ?, ?)").run(id, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"); db.prepare("INSERT INTO job_opportunity_details VALUES (?, NULL, NULL, NULL, NULL, NULL)").run(id); } finally { db.close(); } return id; }
function tableExists(name: string) { const db = new Database(dbPath); try { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)); } finally { db.close(); } }
function currentJob(status = "wishlist") {
  const db = new Database(dbPath);
  ensureOpportunitySchema(db);
  db.prepare("INSERT INTO opportunities VALUES ('job-id','job','Role','Acme',?,'medium',NULL,NULL,?,?)").run(status, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  db.prepare("INSERT INTO job_opportunity_details VALUES ('job-id',NULL,NULL,NULL,NULL,NULL)").run();
  db.close();
}
function automated(file: string, token: string, ...extra: string[]) {
  return spawnSync(process.execPath, ["scripts/register-application-artifact.mjs", "--db", dbPath, "--opportunity-id", "job-id", "--type", "resume", "--title", "Resume", "--file", file, "--lock-token", token, "--expected-status", "wishlist", ...extra], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
}
function databaseState() {
  const db = new Database(dbPath, { readonly: true });
  try {
    return JSON.stringify({
      schema: db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all(),
      metadata: tableExists("schema_metadata") ? db.prepare("SELECT * FROM schema_metadata ORDER BY key").all() : [],
      opportunity: db.prepare("SELECT status,updated_at FROM opportunities WHERE id='job-id'").get(),
      artifacts: tableExists("opportunity_artifacts") ? db.prepare("SELECT * FROM opportunity_artifacts ORDER BY id").all() : []
    });
  } finally {
    db.close();
  }
}
beforeEach(() => { tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-artifact-cli-")); dbPath = path.join(tempDir, "test.sqlite"); });
afterEach(() => { rmSync(tempDir, { force: true, recursive: true }); });
describe("register-application-artifact CLI", () => {
  it("registers for a matching active lock and wishlist status", () => {
    currentJob();
    const file = path.join(tempDir, "resume.pdf");
    writeFileSync(file, "resume");
    const lock = acquireDailyJobPrepLock(dbPath);

    const result = automated(file, lock.token);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ action: "registered", opportunity: { id: "job-id", status: "wishlist" }, artifact: { type: "resume", title: "Resume", filePath: file } });
  });

  it.each(["rejected", "archived"])("does not mutate an opportunity changed to %s after lock acquisition", (status) => {
    currentJob();
    const file = path.join(tempDir, "resume.pdf");
    writeFileSync(file, "resume");
    const lock = acquireDailyJobPrepLock(dbPath);
    const db = new Database(dbPath);
    db.prepare("UPDATE opportunities SET status=?, updated_at='2026-01-02T00:00:00.000Z' WHERE id='job-id'").run(status);
    db.close();
    const before = databaseState();

    const result = automated(file, lock.token);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/status/i);
    expect(databaseState()).toBe(before);
  });

  it("rejects a wrong and an expired lock without registering", () => {
    currentJob();
    const file = path.join(tempDir, "resume.pdf");
    writeFileSync(file, "resume");
    const active = acquireDailyJobPrepLock(dbPath);
    const activeState = databaseState();

    expect(automated(file, "00000000-0000-4000-8000-000000000000").status).toBe(1);
    expect(databaseState()).toBe(activeState);
    releaseDailyJobPrepLock(dbPath, active.token);
    const expired = acquireDailyJobPrepLock(dbPath, Date.now() - LOCK_TTL_MS - 1);
    const expiredState = databaseState();
    expect(automated(file, expired.token).status).toBe(1);
    expect(databaseState()).toBe(expiredState);
  });

  it("requires complete guarded options and rejects unknown or non-absolute automated arguments", () => {
    currentJob();
    const file = path.join(tempDir, "resume.pdf");
    writeFileSync(file, "resume");
    const lock = acquireDailyJobPrepLock(dbPath);
    const base = ["scripts/register-application-artifact.mjs", "--db", dbPath, "--opportunity-id", "job-id", "--type", "resume", "--title", "Resume", "--file", file];
    const cases = [
      [...base, "--lock-token", lock.token],
      [...base, "--expected-status", "wishlist"],
      [...base, "--lock-token", lock.token, "--expected-status", "wishlist", "--unknown", "x"],
      [...base.slice(0, 2), path.relative(path.resolve(__dirname, ".."), dbPath), ...base.slice(3), "--lock-token", lock.token, "--expected-status", "wishlist"]
    ];
    for (const args of cases) {
      const result = spawnSync(process.execPath, args, { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
    }
  });

  it("does not create or migrate schema in automated mode", () => {
    job();
    const file = path.join(tempDir, "resume.pdf");
    writeFileSync(file, "resume");
    const before = databaseState();

    const result = automated(file, "00000000-0000-4000-8000-000000000000");

    expect(result.status).toBe(1);
    expect(databaseState()).toBe(before);
    expect(tableExists("opportunity_artifacts")).toBe(false);
  });
  it("rejects an automated non-wishlist expected status before mutation", () => {
    const db = new Database(dbPath); ensureOpportunitySchema(db); db.prepare("INSERT INTO opportunities VALUES ('job-id','job','Role','Acme','rejected','medium',NULL,NULL,?,?)").run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"); db.prepare("INSERT INTO job_opportunity_details VALUES ('job-id',NULL,NULL,NULL,NULL,NULL)").run(); db.close();
    const file = path.join(tempDir, "resume.pdf"); writeFileSync(file, "resume"); const lock = acquireDailyJobPrepLock(dbPath);
    const result = spawnSync(process.execPath, ["scripts/register-application-artifact.mjs", "--db", dbPath, "--opportunity-id", "job-id", "--type", "resume", "--title", "Resume", "--file", file, "--lock-token", lock.token, "--expected-status", "rejected"], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    expect(result.status).toBe(1); const verify = new Database(dbPath); expect(verify.prepare("SELECT COUNT(*) AS count FROM opportunity_artifacts").get()).toEqual({ count: 0 }); verify.close();
  });
  it("rejects a missing artifact path before database mutation", () => {
    job();
    const result = spawnSync(process.execPath, ["scripts/register-application-artifact.mjs", "--db", dbPath, "--opportunity-id", "job-id", "--type", "resume", "--title", "Resume", "--file", path.join(tempDir, "missing.pdf")], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    expect(result.status).toBe(1); expect(result.stderr).toMatch(/artifact file not found/i); expect(tableExists("opportunity_artifacts")).toBe(false);
  });
  it("rejects a directory before database mutation", () => {
    job(); const directory = path.join(tempDir, "resume.pdf"); mkdirSync(directory);
    const result = spawnSync(process.execPath, ["scripts/register-application-artifact.mjs", "--db", dbPath, "--opportunity-id", "job-id", "--type", "resume", "--title", "Resume", "--file", directory], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    expect(result.status).toBe(1); expect(result.stderr).toMatch(/regular file/i); expect(tableExists("opportunity_artifacts")).toBe(false);
  });
  it("registers with canonical opportunity-id and accepts application-id as a deprecated alias", () => {
    const id = job(); const file = path.join(tempDir, "fit.md"); writeFileSync(file, "# Fit");
    const canonical = run(["--opportunity-id", id, "--type", "fit_analysis", "--title", "Fit Analysis", "--file", file]);
    const alias = run(["--application-id", id, "--type", "resume", "--title", "Resume", "--file", file]);
    expect(canonical).toMatchObject({ action: "registered", opportunity: { id, type: "job" }, artifact: { opportunityId: id, applicationId: id } });
    expect(canonical.application).toEqual(canonical.opportunity); expect(alias.application).toEqual(alias.opportunity);
  });
  it("matches only job opportunities and rejects a connection id", () => {
    job(); const db = new Database(dbPath); try { db.prepare("INSERT INTO opportunities VALUES ('connection-id', 'connection', 'Frontend Engineer', 'Acme', 'new', 'medium', NULL, NULL, ?, ?)").run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"); } finally { db.close(); }
    const file = path.join(tempDir, "fit.md"); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, "# Fit");
    expect(run(["--company", "acme", "--role", "frontend engineer", "--type", "fit_analysis", "--title", "Fit", "--file", file]).opportunity.id).toBe("job-id");
    const rejected = spawnSync(process.execPath, ["scripts/register-application-artifact.mjs", "--db", dbPath, "--opportunity-id", "connection-id", "--type", "fit_analysis", "--title", "Fit", "--file", file], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    expect(rejected.status).toBe(1); expect(rejected.stderr).toContain("Artifacts can only be registered to job opportunities");
  });
  it("migrates an unmigrated legacy database before registering an artifact", () => {
    const db = new Database(dbPath); try { db.exec("CREATE TABLE applications (id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, source TEXT, location TEXT, url TEXT, contact TEXT, notes TEXT, applied_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);"); db.prepare("INSERT INTO applications VALUES ('legacy-job', 'Acme', 'Frontend Engineer', 'wishlist', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)").run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"); } finally { db.close(); }
    const file = path.join(tempDir, "fit.md"); writeFileSync(file, "# Fit");
    expect(run(["--opportunity-id", "legacy-job", "--type", "fit_analysis", "--title", "Fit", "--file", file]).artifact.opportunityId).toBe("legacy-job");
    const migrated = new Database(dbPath); migrated.pragma("foreign_keys = ON");
    try {
      for (const table of ["job_opportunity_details", "opportunity_activities", "opportunity_tasks", "opportunity_artifacts"]) expect(migrated.prepare(`PRAGMA foreign_key_list(${table})`).all()).toEqual(expect.arrayContaining([expect.objectContaining({ table: "opportunities", on_delete: "CASCADE" })]));
      expect(migrated.prepare("PRAGMA foreign_key_list(opportunity_tasks)").all()).toEqual(expect.arrayContaining([expect.objectContaining({ table: "opportunity_activities", on_delete: "SET NULL" })]));
      migrated.prepare("DELETE FROM opportunities WHERE id='legacy-job'").run();
      for (const table of ["job_opportunity_details", "opportunity_activities", "opportunity_tasks", "opportunity_artifacts"]) expect(migrated.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE opportunity_id='legacy-job'`).get()).toEqual({ count: 0 });
    } finally { migrated.close(); }
  });
});
