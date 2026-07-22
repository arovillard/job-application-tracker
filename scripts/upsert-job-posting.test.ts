import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireDailyJobPrepLock, LOCK_TTL_MS, releaseDailyJobPrepLock } from "./lib/daily-job-prep-lock.mjs";
import { initializeDatabaseIdentity } from "./lib/jobtracker-database-identity.mjs";

let tempDir: string;
let dbPath: string;
const timestamp = "2026-01-01T00:00:00.000Z";

function runUpsert(args: string[]) {
  const output = execFileSync(process.execPath, ["scripts/upsert-job-posting.mjs", "--db", dbPath, ...args], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8"
  });

  return JSON.parse(output) as {
    action: "created" | "updated";
    opportunity: { id: string; type: "job"; label: string; organization: string; status: string; url: string | null; summary: string | null; followUpDate: string | null };
    application: unknown;
    changes: string[];
    activityIds: string[];
    taskIds: string[];
  };
}

function query(sql: string, ...params: unknown[]) {
  const db = new Database(dbPath);
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
}

function automatedWithToken(token: string, args: string[], input = { company: "Example Co", role: "Engineering Manager", url: "https://example.com/job", posting_state: "open" }) {
  return spawnSync(process.execPath, ["scripts/upsert-job-posting.mjs", "--db", dbPath, "--automation-mode", "--lock-token", token, ...args, "--input-json", "-"], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", input: JSON.stringify(input) });
}

beforeEach(() => { tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-upsert-")); dbPath = path.join(tempDir, "jobtracker.sqlite"); });
afterEach(() => { rmSync(tempDir, { force: true, recursive: true }); });

describe("upsert-job-posting CLI", () => {
  it("creates a wishlist job opportunity with activities and a requested follow-up task", () => {
    const result = runUpsert(["--company", " Example Co ", "--role", " Engineering Manager ", "--url", "https://example.com/job", "--summary", " Leads a product engineering team. ", "--posting-state", "open", "--follow-up-date", "2026-07-20"]);

    expect(result.opportunity).toMatchObject({ type: "job", label: "Engineering Manager", organization: "Example Co", status: "wishlist", url: "https://example.com/job", summary: "Leads a product engineering team.", followUpDate: "2026-07-20" });
    expect(result.application).toEqual(result.opportunity);
    expect(result.activityIds).toHaveLength(3);
    expect(result.taskIds).toHaveLength(1);
    expect(query("SELECT COUNT(*) AS count FROM opportunities WHERE type = 'job'")[0]).toEqual({ count: 1 });
    expect(query("SELECT COUNT(*) AS count FROM opportunity_activities WHERE opportunity_id = ?", result.opportunity.id)[0]).toEqual({ count: 3 });
    expect(query("SELECT COUNT(*) AS count FROM opportunity_tasks WHERE opportunity_id = ? AND state = 'open'", result.opportunity.id)[0]).toEqual({ count: 1 });
  });

  it("updates a duplicate job, records a note activity, and leaves a same-label connection untouched", () => {
    const first = runUpsert(["--company", "Example Co", "--role", "Engineering Manager", "--url", "https://example.com/jobs/old", "--posting-state", "open"]);
    const db = new Database(dbPath);
    try {
      db.prepare("INSERT INTO opportunities VALUES (?, 'connection', ?, ?, 'new', 'medium', NULL, NULL, ?, ?)").run("connection-id", "Engineering Manager", "Example Co", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
      db.prepare("INSERT INTO connection_opportunity_details VALUES (?, NULL, NULL, NULL, 'new')").run("connection-id");
    } finally { db.close(); }

    const updated = runUpsert(["--company", " example co ", "--role", "Engineering   Manager", "--url", "https://example.com/jobs/new", "--source", "Example Careers", "--location", "Hybrid", "--posting-state", "open"]);

    expect(updated.action).toBe("updated");
    expect(updated.opportunity).toMatchObject({ id: first.opportunity.id, type: "job", label: "Engineering Manager", organization: "Example Co", url: "https://example.com/jobs/new" });
    expect(updated.application).toEqual(updated.opportunity);
    expect(updated.changes).toEqual(["source: example.com -> Example Careers", "location: blank -> Hybrid", "url: https://example.com/jobs/old -> https://example.com/jobs/new"]);
    expect(updated.activityIds).toHaveLength(1);
    expect(query("SELECT COUNT(*) AS count FROM opportunities WHERE type = 'job'")[0]).toEqual({ count: 1 });
    expect(query("SELECT COUNT(*) AS count FROM opportunities WHERE type = 'connection' AND organization = 'Example Co' AND label = 'Engineering Manager'")[0]).toEqual({ count: 1 });
    expect(query("SELECT type FROM opportunity_activities WHERE id = ?", updated.activityIds[0])[0]).toEqual({ type: "note" });
  });

  it("reactivates an archived job opportunity without creating a duplicate", () => {
    const created = runUpsert(["--company", "Example Co", "--role", "Engineering Manager", "--url", "https://example.com/job", "--status", "archived", "--posting-state", "closed"]);
    const updated = runUpsert(["--company", "Example Co", "--role", "Engineering Manager", "--url", "https://example.com/job", "--posting-state", "open", "--reactivate"]);
    expect(updated.opportunity).toMatchObject({ id: created.opportunity.id, status: "wishlist" });
    expect(query("SELECT COUNT(*) AS count FROM opportunities WHERE type = 'job'")[0]).toEqual({ count: 1 });
  });

  it("does not persist a job opportunity when dry-run is requested", () => {
    const result = runUpsert(["--company", "Dry Run Co", "--role", "Staff Engineer", "--url", "https://example.com/dry-run", "--dry-run"]);
    expect(result.opportunity).toMatchObject({ organization: "Dry Run Co", label: "Staff Engineer" });
    expect(existsSync(dbPath)).toBe(false);
  });

  it("leaves a fresh database path absent for dry-run", () => {
    expect(existsSync(dbPath)).toBe(false);
    runUpsert(["--company", "Dry Run Co", "--role", "Staff Engineer", "--url", "https://example.com/dry-run", "--dry-run"]);
    expect(existsSync(dbPath)).toBe(false);
  });

  it("leaves legacy schema and migration marker unchanged for dry-run", () => {
    const db = new Database(dbPath);
    try {
      db.exec("CREATE TABLE applications (id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, source TEXT, location TEXT, url TEXT, contact TEXT, notes TEXT, applied_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);");
      db.prepare("INSERT INTO applications VALUES ('legacy-dry', 'Acme', 'Engineer', 'wishlist', NULL, NULL, 'https://example.com/job', NULL, NULL, NULL, ?, ?)").run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    } finally { db.close(); }
    runUpsert(["--company", "Acme", "--role", "Engineer", "--url", "https://example.com/job", "--dry-run"]);
    const unchanged = new Database(dbPath);
    try {
      expect(unchanged.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='opportunities'").get()).toBeUndefined();
      expect(unchanged.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_metadata'").get()).toBeUndefined();
    } finally { unchanged.close(); }
  });

  it("migrates a legacy application before locating its job opportunity", () => {
    const db = new Database(dbPath);
    try {
      db.exec("CREATE TABLE applications (id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, source TEXT, location TEXT, url TEXT, contact TEXT, notes TEXT, applied_date TEXT, next_action TEXT, next_action_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE application_notes (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL, follow_up_date TEXT, created_at TEXT NOT NULL);");
      db.prepare("INSERT INTO applications VALUES ('legacy-job', 'Acme', 'Platform Engineer', 'wishlist', 'Careers', NULL, 'https://example.com/old', NULL, NULL, NULL, 'Follow up', '2026-07-20', ?, ?)").run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    } finally { db.close(); }
    const result = runUpsert(["--company", "Acme", "--role", "Platform Engineer", "--url", "https://example.com/new", "--posting-state", "open"]);
    expect(result).toMatchObject({ action: "updated", opportunity: { id: "legacy-job", type: "job", url: "https://example.com/new" } });
    expect(query("SELECT COUNT(*) AS count FROM opportunity_tasks WHERE opportunity_id = 'legacy-job' AND title = 'Follow up'")[0]).toEqual({ count: 1 });
  });

  it("preserves terminal next actions while skipping follow-up tasks", () => {
    const db = new Database(dbPath);
    try {
      db.exec("CREATE TABLE applications (id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, source TEXT, location TEXT, url TEXT, contact TEXT, notes TEXT, applied_date TEXT, next_action TEXT, next_action_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE application_notes (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL, follow_up_date TEXT, created_at TEXT NOT NULL);");
      for (const status of ["archived", "rejected"]) db.prepare("INSERT INTO applications VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, 'Next action', '2026-07-20', ?, ?)").run(`${status}-id`, status, "Role", status, `https://example.com/${status}`, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
      for (const status of ["archived", "rejected"]) db.prepare("INSERT INTO application_notes VALUES (?, ?, 'follow_up', 'Follow up', '2026-07-21', ?)").run(`${status}-note`, `${status}-id`, "2026-01-01T00:00:00.000Z");
    } finally { db.close(); }
    runUpsert(["--company", "archived", "--role", "Role", "--url", "https://example.com/archived", "--posting-state", "closed"]);
    expect(query("SELECT opportunity_id, title, due_date FROM opportunity_tasks WHERE opportunity_id IN ('archived-id', 'rejected-id') ORDER BY opportunity_id")).toEqual([
      { opportunity_id: "archived-id", title: "Next action", due_date: "2026-07-20" },
      { opportunity_id: "rejected-id", title: "Next action", due_date: "2026-07-20" }
    ]);
    expect(query("SELECT id, type FROM opportunity_activities WHERE id IN ('archived-note', 'rejected-note') ORDER BY id")).toEqual([
      { id: "archived-note", type: "note" }, { id: "rejected-note", type: "note" }
    ]);
  });

  it("rejects impossible applied and follow-up calendar dates", () => {
    expect(() => runUpsert(["--company", "Example Co", "--role", "Engineer", "--url", "https://example.com/job", "--applied-date", "2026-02-31"])).toThrow(/calendar date/i);
    expect(() => runUpsert(["--company", "Example Co", "--role", "Engineer", "--url", "https://example.com/job", "--follow-up-date", "2026-99-01"])).toThrow(/calendar date/i);
  });

  it("keeps punctuation-distinct migrated task titles on the same due date", () => {
    const db = new Database(dbPath);
    try {
      db.exec("CREATE TABLE applications (id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, source TEXT, location TEXT, url TEXT, contact TEXT, notes TEXT, applied_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE application_notes (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL, follow_up_date TEXT, created_at TEXT NOT NULL);");
      db.prepare("INSERT INTO applications VALUES ('punctuation-job', 'Acme', 'Engineer', 'wishlist', NULL, NULL, 'https://example.com/job', NULL, NULL, NULL, ?, ?)").run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
      db.prepare("INSERT INTO application_notes VALUES ('note-one', 'punctuation-job', 'follow_up', 'Follow-up', '2026-07-20', ?), ('note-two', 'punctuation-job', 'follow_up', 'Follow up', '2026-07-20', ?)").run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    } finally { db.close(); }
    runUpsert(["--company", "Acme", "--role", "Engineer", "--url", "https://example.com/job"]);
    expect(query("SELECT title FROM opportunity_tasks WHERE opportunity_id='punctuation-job' ORDER BY title")).toEqual([{ title: "Follow up" }, { title: "Follow-up" }]);
  });

  it("uses committed WAL state for dry-run duplicate lookup without writing the source", () => {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE opportunities (id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, organization TEXT, status TEXT NOT NULL, priority TEXT NOT NULL, summary TEXT, origin_opportunity_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE job_opportunity_details (opportunity_id TEXT PRIMARY KEY, url TEXT, source TEXT, location TEXT, contact TEXT, applied_date TEXT); CREATE TABLE opportunity_activities (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL, metadata_json TEXT, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE opportunity_tasks (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, title TEXT NOT NULL, due_date TEXT, state TEXT NOT NULL, source_activity_id TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE opportunity_artifacts (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, file_path TEXT NOT NULL, content_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(opportunity_id,type,file_path)); CREATE TABLE connection_opportunity_details (opportunity_id TEXT PRIMARY KEY, role_context TEXT, contact_info TEXT, meeting_context TEXT, relationship_strength TEXT NOT NULL); CREATE TABLE schema_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    db.prepare("INSERT INTO opportunities VALUES ('wal-job', 'job', 'Engineer', 'Acme', 'wishlist', 'medium', NULL, NULL, ?, ?)").run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    db.prepare("INSERT INTO job_opportunity_details VALUES ('wal-job', 'https://example.com/old', 'Careers', NULL, NULL, NULL)").run();
    try {
      const result = runUpsert(["--company", "Acme", "--role", "Engineer", "--url", "https://example.com/new", "--dry-run"]);
      expect(result).toMatchObject({ action: "updated", opportunity: { id: "wal-job", url: "https://example.com/new" } });
      expect(db.prepare("SELECT url FROM job_opportunity_details WHERE opportunity_id='wal-job'").get()).toEqual({ url: "https://example.com/old" });
    } finally { db.close(); }
  });

  it("keeps canonical output keys, CLI values over JSON, and user note text", () => {
    const input = path.join(tempDir, "posting.json");
    writeFileSync(input, JSON.stringify({ company: "JSON Co", role: "Engineer", url: "https://example.com/json", note: "Keep this note" }));
    const result = runUpsert(["--input-json", input, "--company", "CLI Co"]);
    expect(Object.keys(result).sort()).toEqual(["action", "activityIds", "application", "changes", "opportunity", "taskIds"]);
    expect(result.opportunity.organization).toBe("CLI Co");
    expect(query("SELECT body FROM opportunity_activities WHERE id = ?", result.activityIds[1])[0]).toEqual(expect.objectContaining({ body: expect.stringContaining("Keep this note") }));
  });

  it("returns an existing pre-mutation snapshot from automated dry-run", () => {
    const created = runUpsert(["--company", "Example Co", "--role", "Engineering Manager", "--url", "https://example.com/job", "--posting-state", "open"]);
    initializeDatabaseIdentity(dbPath);
    const lock = acquireDailyJobPrepLock(dbPath);
    const bytes = readFileSync(dbPath);
    const mtime = statSync(dbPath).mtimeMs;
    const result = automatedWithToken(lock.token, ["--dry-run"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).precondition).toEqual({ existed: true, opportunityId: created.opportunity.id, status: "wishlist", updatedAt: expect.any(String) });
    expect(readFileSync(dbPath)).toEqual(bytes);
    expect(statSync(dbPath).mtimeMs).toBe(mtime);
  });

  it("creates only when expect-new is still true", () => {
    runUpsert(["--company", "Other", "--role", "Other", "--url", "https://example.com/other", "--posting-state", "open"]);
    initializeDatabaseIdentity(dbPath);
    const lock = acquireDailyJobPrepLock(dbPath);
    const payload = JSON.stringify({ company: "Race Co", role: "Engineer", url: "https://example.com/race", posting_state: "open" });
    const dry = spawnSync(process.execPath, ["scripts/upsert-job-posting.mjs", "--db", dbPath, "--automation-mode", "--lock-token", lock.token, "--dry-run", "--input-json", "-"], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", input: payload });
    expect(dry.status).toBe(0);
    runUpsert(["--company", "Race Co", "--role", "Engineer", "--url", "https://example.com/race", "--posting-state", "open"]);
    const real = spawnSync(process.execPath, ["scripts/upsert-job-posting.mjs", "--db", dbPath, "--automation-mode", "--lock-token", lock.token, "--expect-new", "--input-json", "-"], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", input: payload });
    expect(real.status).toBe(1);
    expect(query("SELECT COUNT(*) AS count FROM opportunities WHERE organization='Race Co'")[0]).toEqual({ count: 1 });
  });

  it("updates with the exact existing id/status/version", () => {
    const created = runUpsert(["--company", "Example Co", "--role", "Engineering Manager", "--url", "https://example.com/old", "--posting-state", "open"]);
    initializeDatabaseIdentity(dbPath);
    const snapshot = query("SELECT updated_at FROM opportunities WHERE id=?", created.opportunity.id)[0] as { updated_at: string };
    const lock = acquireDailyJobPrepLock(dbPath);
    const base = ["scripts/upsert-job-posting.mjs", "--db", dbPath, "--automation-mode", "--lock-token", lock.token, "--expected-opportunity-id", created.opportunity.id, "--expected-status", "wishlist", "--expected-updated-at", snapshot.updated_at, "--input-json", "-"];
    const good = spawnSync(process.execPath, base, { cwd: path.resolve(__dirname, ".."), encoding: "utf8", input: JSON.stringify({ company: "Example Co", role: "Engineering Manager", url: "https://example.com/new", posting_state: "open" }) });
    expect(good.status).toBe(0);
    expect(JSON.parse(good.stdout)).toMatchObject({ action: "updated", opportunity: { id: created.opportunity.id, status: "wishlist", url: "https://example.com/new" }, precondition: { existed: true, opportunityId: created.opportunity.id, status: "wishlist", updatedAt: snapshot.updated_at }, activityIds: [expect.any(String)] });
  });

  it.each([
    ["id", "wrong-opportunity", null, null],
    ["status", null, "applied", null],
    ["version", null, null, "1999-01-01T00:00:00.000Z"]
  ])("independently rejects an expected-existing %s mismatch without mutation", (_field, wrongId, wrongStatus, wrongVersion) => {
    const created = runUpsert(["--company", "Example Co", "--role", "Engineering Manager", "--url", "https://example.com/old", "--posting-state", "open"]);
    initializeDatabaseIdentity(dbPath);
    const snapshot = query("SELECT status,updated_at FROM opportunities WHERE id=?", created.opportunity.id)[0] as { status: string; updated_at: string };
    const lock = acquireDailyJobPrepLock(dbPath);
    const before = readFileSync(dbPath);
    const mtime = statSync(dbPath).mtimeMs;
    const result = automatedWithToken(lock.token, [
      "--expected-opportunity-id", wrongId || created.opportunity.id,
      "--expected-status", wrongStatus || snapshot.status,
      "--expected-updated-at", wrongVersion || snapshot.updated_at
    ], { company: "Example Co", role: "Engineering Manager", url: "https://example.com/new", posting_state: "open" });

    expect(result.status).toBe(1);
    expect(readFileSync(dbPath)).toEqual(before);
    expect(statSync(dbPath).mtimeMs).toBe(mtime);
  });

  it("prevents a released predecessor token from writing after a successor acquires", () => {
    runUpsert(["--company", "Seed", "--role", "Seed", "--url", "https://example.com/seed", "--posting-state", "open"]);
    initializeDatabaseIdentity(dbPath);
    const predecessor = acquireDailyJobPrepLock(dbPath);
    releaseDailyJobPrepLock(dbPath, predecessor.token);
    acquireDailyJobPrepLock(dbPath);
    const before = readFileSync(dbPath);
    const mtime = statSync(dbPath).mtimeMs;

    const result = automatedWithToken(predecessor.token, ["--expect-new"], { company: "Race Co", role: "Engineer", url: "https://example.com/race", posting_state: "open" });

    expect(result.status).toBe(1);
    expect(readFileSync(dbPath)).toEqual(before);
    expect(statSync(dbPath).mtimeMs).toBe(mtime);
    expect(query("SELECT COUNT(*) AS count FROM opportunities WHERE organization='Race Co'")[0]).toEqual({ count: 0 });
  });

  it("prevents an expired predecessor token from writing after takeover", () => {
    runUpsert(["--company", "Seed", "--role", "Seed", "--url", "https://example.com/seed", "--posting-state", "open"]);
    initializeDatabaseIdentity(dbPath);
    const predecessor = acquireDailyJobPrepLock(dbPath, Date.now() - LOCK_TTL_MS - 1);
    acquireDailyJobPrepLock(dbPath);
    const before = readFileSync(dbPath);
    const mtime = statSync(dbPath).mtimeMs;

    const result = automatedWithToken(predecessor.token, ["--expect-new"], { company: "Race Co", role: "Engineer", url: "https://example.com/race", posting_state: "open" });

    expect(result.status).toBe(1);
    expect(readFileSync(dbPath)).toEqual(before);
    expect(statSync(dbPath).mtimeMs).toBe(mtime);
    expect(query("SELECT COUNT(*) AS count FROM opportunities WHERE organization='Race Co'")[0]).toEqual({ count: 0 });
  });

  it.each(["rejected", "archived"])("never mutates an automated %s duplicate", (status) => {
    const created = runUpsert(["--company", "Example Co", "--role", "Engineering Manager", "--url", "https://example.com/job", "--status", status, "--posting-state", "closed"]);
    initializeDatabaseIdentity(dbPath);
    const row = query("SELECT updated_at FROM opportunities WHERE id=?", created.opportunity.id)[0] as { updated_at: string };
    const lock = acquireDailyJobPrepLock(dbPath);
    const before = readFileSync(dbPath);
    const result = spawnSync(process.execPath, ["scripts/upsert-job-posting.mjs", "--db", dbPath, "--automation-mode", "--lock-token", lock.token, "--expected-opportunity-id", created.opportunity.id, "--expected-status", status, "--expected-updated-at", row.updated_at, "--input-json", "-"], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", input: JSON.stringify({ company: "Example Co", role: "Engineering Manager", url: "https://example.com/new", posting_state: "open" }) });
    expect(result.status).toBe(1); expect(readFileSync(dbPath)).toEqual(before);
  });

  it("rejects a wrong active-lock token without mutation", () => {
    runUpsert(["--company", "Example Co", "--role", "Engineer", "--url", "https://example.com/job", "--posting-state", "open"]);
    initializeDatabaseIdentity(dbPath);
    acquireDailyJobPrepLock(dbPath);
    const before = readFileSync(dbPath);
    const mtime = statSync(dbPath).mtimeMs;
    const result = automatedWithToken("00000000-0000-4000-8000-000000000000", ["--dry-run"], { company: "Example Co", role: "Engineer", url: "https://example.com/job", posting_state: "open" });
    expect(result.status).toBe(1);
    expect(readFileSync(dbPath)).toEqual(before);
    expect(statSync(dbPath).mtimeMs).toBe(mtime);
  });

  it("rejects an expired active-lock token without mutation", () => {
    runUpsert(["--company", "Example Co", "--role", "Engineer", "--url", "https://example.com/job", "--posting-state", "open"]);
    initializeDatabaseIdentity(dbPath);
    const expired = acquireDailyJobPrepLock(dbPath, Date.now() - LOCK_TTL_MS - 1);
    const before = readFileSync(dbPath);
    const mtime = statSync(dbPath).mtimeMs;
    const result = automatedWithToken(expired.token, ["--dry-run"], { company: "Example Co", role: "Engineer", url: "https://example.com/job", posting_state: "open" });
    expect(result.status).toBe(1);
    expect(readFileSync(dbPath)).toEqual(before);
    expect(statSync(dbPath).mtimeMs).toBe(mtime);
  });

  it("rejects an incomplete schema without migrating it", () => {
    const bad = path.join(tempDir, "legacy.sqlite"); const db = new Database(bad); db.exec("CREATE TABLE applications (id TEXT)"); db.close(); const bytes = readFileSync(bad);
    expect(spawnSync(process.execPath, ["scripts/upsert-job-posting.mjs", "--db", bad, "--automation-mode", "--lock-token", "00000000-0000-4000-8000-000000000000", "--dry-run", "--input-json", "-"], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", input: JSON.stringify({ company: "Example Co", role: "Engineer", url: "https://example.com/job", posting_state: "open" }) }).status).toBe(1);
    expect(readFileSync(bad)).toEqual(bytes);
  });

  it.each([
    ["lock token", ["--lock-token", "token"]],
    ["expect new", ["--expect-new"]],
    ["expected opportunity id", ["--expected-opportunity-id", "job-id"]],
    ["expected status", ["--expected-status", "wishlist"]],
    ["expected version", ["--expected-updated-at", timestamp]]
  ])("rejects automation-only %s in manual mode without writing", (_name, flags) => {
    const before = existsSync(dbPath) ? readFileSync(dbPath) : null;
    const result = spawnSync(process.execPath, ["scripts/upsert-job-posting.mjs", "--db", dbPath, "--company", "No Write", "--role", "Engineer", "--url", "https://example.com/no-write", ...flags], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(existsSync(dbPath) ? readFileSync(dbPath) : null).toEqual(before);
  });

  it.each([
    ["status", ["--status", "applied"]],
    ["reactivate", ["--reactivate"]],
    ["replace summary", ["--replace-summary"]],
    ["applied date", ["--applied-date", "2026-07-22"]],
    ["follow-up date", ["--follow-up-date", "2026-07-23"]]
  ])("rejects automated manual %s controls without writing", (_name, flags) => {
    runUpsert(["--company", "Seed", "--role", "Engineer", "--url", "https://example.com/seed", "--posting-state", "open"]); initializeDatabaseIdentity(dbPath);
    const lock = acquireDailyJobPrepLock(dbPath), before = readFileSync(dbPath);
    const result = spawnSync(process.execPath, ["scripts/upsert-job-posting.mjs", "--db", dbPath, "--automation-mode", "--lock-token", lock.token, "--expect-new", ...flags, "--input-json", "-"], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", input: JSON.stringify({ company: "No Write", role: "Engineer", url: "https://example.com/no-write", posting_state: "open" }) });
    expect(result.status).toBe(1); expect(readFileSync(dbPath)).toEqual(before);
  });
});
