import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { ensureOpportunitySchema } from "./lib/opportunity-schema.mjs";
import { acquireDailyJobPrepLock, releaseDailyJobPrepLock, verifyDailyJobPrepLock } from "./lib/daily-job-prep-lock.mjs";

const directories: string[] = [];
function fixture() { const d = mkdtempSync(path.join(tmpdir(), "jobtracker-lock-")); directories.push(d); const p = path.join(d, "tracker.sqlite"); const db = new Database(p); ensureOpportunitySchema(db); db.close(); return p; }
afterEach(() => { while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true }); });
describe("daily job prep lock", () => {
  it("allows one active token and rejects an overlapping acquire", () => { const p = fixture(); const lock = acquireDailyJobPrepLock(p, 1000); expect(lock.token).toMatch(/^[0-9a-f-]{36}$/); expect(() => acquireDailyJobPrepLock(p, 1001)).toThrow(/lock/i); });
  it("serializes two contenders for an expired row so exactly one wins", async () => { const p = fixture(); const db = new Database(p); db.prepare("INSERT INTO schema_metadata VALUES ('daily_job_prep_lock', ?)").run(JSON.stringify({ schemaVersion: 1, token: "00000000-0000-4000-8000-000000000000", acquiredAt: 0, expiresAt: 1 })); db.close(); const results = await Promise.allSettled([Promise.resolve().then(() => acquireDailyJobPrepLock(p, 2)), Promise.resolve().then(() => acquireDailyJobPrepLock(p, 2))]); expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); expect(results.filter((r) => r.status === "rejected")).toHaveLength(1); });
  it("verifies only the matching token and database path", () => { const p = fixture(); const lock = acquireDailyJobPrepLock(p, 1000); expect(verifyDailyJobPrepLock(p, lock.token, 1001)).toMatchObject({ token: lock.token }); expect(() => verifyDailyJobPrepLock(p, "00000000-0000-4000-8000-000000000000", 1001)).toThrow(); expect(() => verifyDailyJobPrepLock(path.join(path.dirname(p), "other.sqlite"), lock.token, 1001)).toThrow(); });
  it("releases only the matching owner", () => { const p = fixture(); const lock = acquireDailyJobPrepLock(p, 1000); expect(() => releaseDailyJobPrepLock(p, "00000000-0000-4000-8000-000000000000")).toThrow(); expect(verifyDailyJobPrepLock(p, lock.token, 1001)).toBeTruthy(); expect(releaseDailyJobPrepLock(p, lock.token)).toMatchObject({ action: "released" }); expect(() => verifyDailyJobPrepLock(p, lock.token, 1001)).toThrow(); });
  it("recovers one expired lock and issues a new token", () => { const p = fixture(); const old = acquireDailyJobPrepLock(p, 0); const fresh = acquireDailyJobPrepLock(p, 6 * 60 * 60 * 1000 + 1); expect(fresh.token).not.toBe(old.token); });
  it("keeps different database files isolated", () => { const a = fixture(), b = fixture(); expect(acquireDailyJobPrepLock(a, 1).token).not.toBe(acquireDailyJobPrepLock(b, 1).token); });
  it("rejects a malformed lock row instead of replacing it", () => { const p = fixture(); const db = new Database(p); db.prepare("INSERT INTO schema_metadata VALUES ('daily_job_prep_lock', 'not-json')").run(); db.close(); expect(() => acquireDailyJobPrepLock(p, 1)).toThrow(/malformed/i); });
});
