import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureOpportunitySchema } from "./lib/opportunity-schema.mjs";

let dir: string; let dbPath: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "dossier-inspect-")); dbPath = path.join(dir, "tracker.sqlite"); const db = new Database(dbPath); ensureOpportunitySchema(db); db.prepare("INSERT INTO opportunities VALUES ('job-id','job','Role','Acme','wishlist','medium',NULL,NULL,?,?)").run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"); db.prepare("INSERT INTO job_opportunity_details VALUES ('job-id',NULL,NULL,NULL,NULL,NULL)").run(); for (const [type, title] of [["resume", "Resume"], ["fit_analysis", "Fit"], ["cover_letter", "Cover"], ["outreach_message", "Outreach"], ["other", "Submission Guide"]]) { const file = path.join(dir, `${type}.md`); writeFileSync(file, type); db.prepare("INSERT INTO opportunity_artifacts VALUES (?, 'job-id', ?, ?, ?, 'text/markdown', ?, ?)").run(`${type}-id`, type, title, file, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"); } db.close(); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
describe("inspect-job-dossier CLI", () => {
  it("reports a complete five-file dossier", () => { const result = spawnSync(process.execPath, ["scripts/inspect-job-dossier.mjs", "--db", dbPath, "--opportunity-id", "job-id"], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" }); expect(result.status).toBe(0); const output = JSON.parse(result.stdout); expect(output).toMatchObject({ schemaVersion: 1, complete: true, inactive: false, tailoredResumeUrl: null }); expect(output.requirements).toHaveLength(5); expect(output.requirements.every((r: { valid: boolean }) => r.valid)).toBe(true); });
  it("rejects a relative database path", () => { const result = spawnSync(process.execPath, ["scripts/inspect-job-dossier.mjs", "--db", "tracker.sqlite", "--opportunity-id", "job-id"], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" }); expect(result.status).toBe(1); expect(result.stderr).toMatch(/absolute/i); });
});
