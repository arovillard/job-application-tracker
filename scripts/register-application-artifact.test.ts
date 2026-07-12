import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tempDir: string; let dbPath: string;
function run(args: string[]) { return JSON.parse(execFileSync(process.execPath, ["scripts/register-application-artifact.mjs", "--db", dbPath, ...args], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" })) as { action: string; opportunity: { id: string; type: string }; application: unknown; artifact: { opportunityId: string; applicationId: string } }; }
function job(id = "job-id") { const db = new Database(dbPath); try { db.exec("CREATE TABLE opportunities (id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, organization TEXT, status TEXT NOT NULL, priority TEXT NOT NULL, summary TEXT, origin_opportunity_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE job_opportunity_details (opportunity_id TEXT PRIMARY KEY, url TEXT, source TEXT, location TEXT, contact TEXT, applied_date TEXT);"); db.prepare("INSERT INTO opportunities VALUES (?, 'job', 'Frontend Engineer', 'Acme', 'wishlist', 'medium', NULL, NULL, ?, ?)").run(id, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"); db.prepare("INSERT INTO job_opportunity_details VALUES (?, NULL, NULL, NULL, NULL, NULL)").run(id); } finally { db.close(); } return id; }
beforeEach(() => { tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-artifact-cli-")); dbPath = path.join(tempDir, "test.sqlite"); });
afterEach(() => { rmSync(tempDir, { force: true, recursive: true }); });
describe("register-application-artifact CLI", () => {
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
});
