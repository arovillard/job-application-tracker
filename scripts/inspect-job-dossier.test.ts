import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireDailyJobPrepLock, LOCK_TTL_MS } from "./lib/daily-job-prep-lock.mjs";
import { ensureOpportunitySchema } from "./lib/opportunity-schema.mjs";

const projectRoot = path.resolve(__dirname, "..");
const timestamp = "2026-01-01T00:00:00.000Z";
const artifacts = [
  ["resume", "Resume"],
  ["fit_analysis", "Fit Analysis"],
  ["cover_letter", "Cover Letter"],
  ["outreach_message", "Outreach Message"],
  ["other", "Submission Guide"]
] as const;

let directory: string;
let databasePath: string;

function open() {
  return new Database(databasePath);
}

function insertOpportunity(id = "job-id", type = "job", status = "wishlist") {
  const db = open();
  try {
    db.prepare("INSERT INTO opportunities VALUES (?, ?, 'Role', 'Acme', ?, 'medium', NULL, NULL, ?, ?)").run(id, type, status, timestamp, timestamp);
    if (type === "job") db.prepare("INSERT INTO job_opportunity_details VALUES (?, NULL, NULL, NULL, NULL, NULL)").run(id);
    else db.prepare("INSERT INTO connection_opportunity_details VALUES (?, NULL, NULL, NULL, 'new')").run(id);
  } finally {
    db.close();
  }
}

function register(type: string, title: string, filePath: string, id = `${type}-${title}`) {
  const db = open();
  try {
    db.prepare("INSERT INTO opportunity_artifacts VALUES (?, 'job-id', ?, ?, ?, 'text/markdown', ?, ?)").run(id, type, title, filePath, timestamp, timestamp);
  } finally {
    db.close();
  }
}

function createCompleteDossier() {
  for (const [type, title] of artifacts) {
    const filePath = path.join(directory, `${type}-${title.replaceAll(" ", "-")}.md`);
    writeFileSync(filePath, `${type}:${title}`);
    register(type, title, filePath);
  }
}

function run(...args: string[]) {
  return spawnSync(process.execPath, ["scripts/inspect-job-dossier.mjs", ...args], {
    cwd: projectRoot,
    encoding: "utf8"
  });
}

function inspect(...extra: string[]) {
  return run("--db", databasePath, "--opportunity-id", "job-id", ...extra);
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "dossier-inspect-"));
  databasePath = path.join(directory, "tracker.sqlite");
  const db = open();
  ensureOpportunitySchema(db);
  db.close();
  insertOpportunity();
  createCompleteDossier();
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("inspect-job-dossier CLI", () => {
  it("reports a complete five-file dossier without changing database bytes or mtime", () => {
    const bytes = readFileSync(databasePath);
    const mtime = statSync(databasePath).mtimeMs;

    const result = inspect();

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 1,
      complete: true,
      inactive: false,
      tailoredResumeUrl: null,
      requirements: artifacts.map(([type, title], index) => ({
        key: index === 4 ? "submission_guide" : type,
        type,
        requiredTitle: index === 4 ? title : null,
        registered: true,
        absolutePath: true,
        exists: true,
        regularFile: true,
        valid: true
      }))
    });
    expect(readFileSync(databasePath)).toEqual(bytes);
    expect(statSync(databasePath).mtimeMs).toBe(mtime);
  });

  it("reports unregistered, missing, and relative artifact paths as incomplete", () => {
    const db = open();
    db.prepare("DELETE FROM opportunity_artifacts WHERE type='cover_letter'").run();
    db.prepare("UPDATE opportunity_artifacts SET file_path=? WHERE type='fit_analysis'").run("relative-fit.md");
    const outreach = db.prepare("SELECT file_path FROM opportunity_artifacts WHERE type='outreach_message'").get() as { file_path: string };
    db.close();
    unlinkSync(outreach.file_path);

    const result = inspect();

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.complete).toBe(false);
    expect(output.requirements.find((item: { key: string }) => item.key === "cover_letter")).toMatchObject({ registered: false, valid: false });
    expect(output.requirements.find((item: { key: string }) => item.key === "fit_analysis")).toMatchObject({ registered: true, absolutePath: false, valid: false });
    expect(output.requirements.find((item: { key: string }) => item.key === "outreach_message")).toMatchObject({ registered: true, exists: false, valid: false });
  });

  it.each(["rejected", "archived"])("reports %s as inactive without changing status", (status) => {
    const db = open();
    db.prepare("UPDATE opportunities SET status=? WHERE id='job-id'").run(status);
    db.close();

    const result = inspect();

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ inactive: true, opportunity: { status } });
    const verify = open();
    expect(verify.prepare("SELECT status FROM opportunities WHERE id='job-id'").get()).toEqual({ status });
    verify.close();
  });

  it("chooses a valid older artifact when the newest candidate is invalid", () => {
    const validPath = path.join(directory, "older-resume.pdf");
    writeFileSync(validPath, "older valid resume");
    const db = open();
    db.prepare("UPDATE opportunity_artifacts SET updated_at='2025-01-01T00:00:00.000Z', created_at='2025-01-01T00:00:00.000Z' WHERE type='resume'").run();
    db.prepare("INSERT INTO opportunity_artifacts VALUES ('newer-invalid','job-id','resume','Newer Resume',?,'application/pdf','2026-02-01T00:00:00.000Z','2026-02-01T00:00:00.000Z')").run(path.join(directory, "missing-newer.pdf"));
    db.prepare("UPDATE opportunity_artifacts SET file_path=? WHERE type='resume' AND id!='newer-invalid'").run(validPath);
    db.close();

    const result = inspect();

    expect(result.status).toBe(0);
    const resume = JSON.parse(result.stdout).requirements.find((item: { key: string }) => item.key === "resume");
    expect(resume).toMatchObject({ valid: true, artifact: { filePath: validPath } });
  });

  it("requires the exact Submission Guide title", () => {
    const db = open();
    db.prepare("UPDATE opportunity_artifacts SET title='Application Notes' WHERE type='other'").run();
    db.close();

    const result = inspect();

    const guide = JSON.parse(result.stdout).requirements.find((item: { key: string }) => item.key === "submission_guide");
    expect(guide).toMatchObject({ registered: false, valid: false });
  });

  it.each([
    ["missing opportunity", ["--db", "DB", "--opportunity-id", "missing"], /not found/i],
    ["connection opportunity", ["--db", "DB", "--opportunity-id", "connection-id"], /job opportunities/i]
  ])("rejects a %s", (_name, template, message) => {
    insertOpportunity("connection-id", "connection", "new");
    const args = template.map((value) => value === "DB" ? databasePath : value);
    const result = run(...args);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(message);
  });

  it("rejects a missing database without creating it", () => {
    const missing = path.join(directory, "missing.sqlite");
    const result = run("--db", missing, "--opportunity-id", "job-id");
    expect(result.status).toBe(1);
    expect(existsSync(missing)).toBe(false);
  });

  it("rejects a malformed named-table lookalike without schema mutation", () => {
    const db = open();
    db.exec("DROP INDEX opportunities_updated_at_idx; CREATE INDEX opportunities_updated_at_idx ON opportunities(updated_at ASC)");
    const schema = JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all());
    db.close();

    const result = inspect();

    expect(result.status).toBe(1);
    const verify = open();
    expect(JSON.stringify(verify.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all())).toBe(schema);
    verify.close();
  });

  it("accepts an exact guarded wishlist status/version snapshot", () => {
    const lock = acquireDailyJobPrepLock(databasePath);
    const result = inspect("--lock-token", lock.token, "--expected-status", "wishlist", "--expected-updated-at", timestamp);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).complete).toBe(true);
  });

  it("rejects stale status/version, mismatched lock, expired lock, and partial guard arguments", () => {
    const active = acquireDailyJobPrepLock(databasePath);
    const db = open();
    db.prepare("UPDATE opportunities SET status='rejected', updated_at='2026-01-02T00:00:00.000Z' WHERE id='job-id'").run();
    db.close();
    expect(inspect("--lock-token", active.token, "--expected-status", "wishlist", "--expected-updated-at", timestamp).status).toBe(1);
    expect(inspect("--lock-token", "00000000-0000-4000-8000-000000000000", "--expected-status", "wishlist", "--expected-updated-at", timestamp).status).toBe(1);
    expect(inspect("--lock-token", active.token).status).toBe(1);

    const secondDir = mkdtempSync(path.join(tmpdir(), "dossier-expired-lock-"));
    const secondDbPath = path.join(secondDir, "tracker.sqlite");
    const secondDb = new Database(secondDbPath);
    ensureOpportunitySchema(secondDb);
    secondDb.close();
    const expired = acquireDailyJobPrepLock(secondDbPath, Date.now() - LOCK_TTL_MS - 1);
    const expiredResult = run("--db", secondDbPath, "--opportunity-id", "missing", "--lock-token", expired.token, "--expected-status", "wishlist", "--expected-updated-at", timestamp);
    expect(expiredResult.status).toBe(1);
    rmSync(secondDir, { recursive: true, force: true });
  });

  it("rejects a relative database path", () => {
    const result = run("--db", "tracker.sqlite", "--opportunity-id", "job-id");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/absolute/i);
  });
});
