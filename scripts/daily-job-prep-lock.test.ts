import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
// @ts-expect-error JavaScript production module intentionally has no declaration file.
import { ensureOpportunitySchema } from "./lib/opportunity-schema.mjs";
// @ts-expect-error JavaScript production module intentionally has no declaration file.
import { LOCK_TTL_MS, acquireDailyJobPrepLock, releaseDailyJobPrepLock, verifyDailyJobPrepLock } from "./lib/daily-job-prep-lock.mjs";

const directories: string[] = [];
function fixture() { const d = mkdtempSync(path.join(tmpdir(), "jobtracker-lock-")); directories.push(d); const p = path.join(d, "tracker.sqlite"); const db = new Database(p); ensureOpportunitySchema(db); db.close(); return p; }
function cli(...args: string[]) { return spawnSync(process.execPath, ["scripts/daily-job-prep-lock.mjs", ...args], { encoding: "utf8", cwd: process.cwd() }); }
function concurrent(...commands: string[][]): Promise<{ status: number | null; stdout: string; stderr: string }[]> { return Promise.all(commands.map((args) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => { const child = spawn(process.execPath, ["scripts/daily-job-prep-lock.mjs", ...args], { cwd: process.cwd() }); let stdout = "", stderr = ""; child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; }); child.on("close", (status) => resolve({ status, stdout, stderr })); }))); }
function seed(p: string, lock: unknown) { const db = new Database(p); db.prepare("INSERT INTO schema_metadata VALUES ('daily_job_prep_lock', ?)").run(JSON.stringify(lock)); db.close(); }
afterEach(() => { while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true }); });
describe("daily job prep lock", () => {
  it("allows one active token and rejects an overlapping acquire", () => { const p = fixture(); const first = cli("acquire", "--db", p); expect(first.status).toBe(0); const second = cli("acquire", "--db", p); expect(second.status).toBe(1); expect(second.stderr).toMatch(/lock/i); });
  it("serializes real child-process contenders for an expired row", async () => { const p = fixture(); const now = Date.now(); seed(p, { schemaVersion: 1, token: "00000000-0000-4000-8000-000000000000", acquiredAt: now - LOCK_TTL_MS - 10, expiresAt: now - 10 }); const results = await concurrent(["acquire", "--db", p], ["acquire", "--db", p]); expect(results.filter((r) => r.status === 0)).toHaveLength(1); expect(results.filter((r) => r.status === 1)).toHaveLength(1); const winner = JSON.parse(results.find((r) => r.status === 0)!.stdout); const db = new Database(p, { readonly: true }); expect(JSON.parse((db.prepare("SELECT value FROM schema_metadata WHERE key='daily_job_prep_lock'").get() as { value: string }).value).token).toBe(winner.token); db.close(); });
  it("serializes owner release and contender acquire without deleting a successor", async () => {
    const p = fixture();
    const owner = acquireDailyJobPrepLock(p);
    const [released, acquired] = await concurrent(
      ["release", "--db", p, "--token", owner.token],
      ["acquire", "--db", p]
    );

    expect(released.status).toBe(0);
    const db = new Database(p, { readonly: true });
    const finalRow = db.prepare("SELECT value FROM schema_metadata WHERE key='daily_job_prep_lock'").get() as { value: string } | undefined;
    db.close();
    if (acquired.status === 0) {
      const successor = JSON.parse(acquired.stdout);
      expect(JSON.parse(finalRow!.value).token).toBe(successor.token);
    } else {
      expect(acquired.status).toBe(1);
      expect(finalRow).toBeUndefined();
    }
  });
  it("verifies and releases only the matching owner token", () => {
    const p = fixture();
    const owner = acquireDailyJobPrepLock(p, 1000);
    const wrongToken = "00000000-0000-4000-8000-000000000000";

    expect(verifyDailyJobPrepLock(p, owner.token, 1001)).toMatchObject({ token: owner.token });
    expect(() => verifyDailyJobPrepLock(p, wrongToken, 1001)).toThrow(/not held/i);
    expect(() => releaseDailyJobPrepLock(p, wrongToken)).toThrow(/not held/i);
    expect(verifyDailyJobPrepLock(p, owner.token, 1001)).toMatchObject({ token: owner.token });

    expect(releaseDailyJobPrepLock(p, owner.token)).toMatchObject({ action: "released" });
    const db = new Database(p, { readonly: true });
    expect(db.prepare("SELECT value FROM schema_metadata WHERE key='daily_job_prep_lock'").get()).toBeUndefined();
    db.close();
  });
  it("releases the owner row through the documented CLI invocation", () => {
    const p = fixture();
    const acquired = cli("acquire", "--db", p);
    expect(acquired.status).toBe(0);
    const token = JSON.parse(acquired.stdout).token;

    const released = cli("release", "--db", p, "--token", token);

    expect(released.status).toBe(0);
    expect(JSON.parse(released.stdout)).toMatchObject({ action: "released" });
    const db = new Database(p, { readonly: true });
    expect(db.prepare("SELECT value FROM schema_metadata WHERE key='daily_job_prep_lock'").get()).toBeUndefined();
    db.close();
  });
  it("isolates valid database paths", () => { const a = fixture(), b = fixture(); const lock = acquireDailyJobPrepLock(a, 1000); expect(() => verifyDailyJobPrepLock(b, lock.token, 1001)).toThrow(); expect(acquireDailyJobPrepLock(b, 1000)).toBeTruthy(); });
  it("recovers an expired lock at a fixed clock with a new token", () => {
    const p = fixture();
    const expiredToken = "00000000-0000-4000-8000-000000000000";
    seed(p, { schemaVersion: 1, token: expiredToken, acquiredAt: 0, expiresAt: LOCK_TTL_MS });

    const recovered = acquireDailyJobPrepLock(p, LOCK_TTL_MS + 1);

    expect(recovered).toMatchObject({ action: "recovered", acquiredAt: LOCK_TTL_MS + 1 });
    expect(recovered.token).not.toBe(expiredToken);
  });
  it("rejects missing, non-file, and relative guarded paths", () => { const p = fixture(); for (const target of [path.join(path.dirname(p), "missing.sqlite"), path.dirname(p), "relative.sqlite"]) { expect(() => acquireDailyJobPrepLock(target)).toThrow(); expect(() => verifyDailyJobPrepLock(target, "00000000-0000-4000-8000-000000000000")).toThrow(); expect(() => releaseDailyJobPrepLock(target, "00000000-0000-4000-8000-000000000000")).toThrow(); } });
  it("rejects malformed lock rows including TTL and extra fields", () => { for (const bad of [{ schemaVersion: 1, token: "00000000-0000-4000-8000-000000000000", acquiredAt: 0, expiresAt: 1 }, { schemaVersion: 1, token: "00000000-0000-4000-8000-000000000000", acquiredAt: 0, expiresAt: LOCK_TTL_MS + 1 }, { schemaVersion: 1, token: "00000000-0000-4000-8000-000000000000", acquiredAt: 0, expiresAt: LOCK_TTL_MS, extra: true }]) { const p = fixture(); seed(p, bad); expect(() => acquireDailyJobPrepLock(p)).toThrow(/malformed/i); } });
  it("has strict action-specific CLI JSON and errors", () => { const p = fixture(); const acquired = cli("acquire", "--db", p); expect(acquired.status).toBe(0); const token = JSON.parse(acquired.stdout).token; expect(cli("verify", "--db", p, "--token", token).status).toBe(0); for (const args of [["acquire", "--db", p, "--token", token], ["acquire", "--db", p, "--db", p], ["verify", "--db", p], ["release", "--db", p, "--token", token, "--extra", "x"], ["wat", "--db", p]]) { const result = cli(...args); expect(result.status).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr.trim().length).toBeGreaterThan(0); } });
});
