import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addOpportunityActivity,
  changeOpportunityStatus,
  createOpportunity,
  createLinkedJobOpportunity,
  createOpportunityTask,
  getOpportunityDetail,
  listOpportunities,
  resetStorageForTests,
  updateOpportunity,
  updateOpportunityTask,
  upsertOpportunityArtifact
} from "./storage";
import { ensureOpportunitySchema, migrateLegacyApplications } from "./opportunity-migration";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-opportunity-storage-"));
  process.env.JOBTRACKER_DB_PATH = path.join(tempDir, "test.sqlite");
});

afterEach(() => {
  resetStorageForTests();
  delete process.env.JOBTRACKER_DB_PATH;
  rmSync(tempDir, { force: true, recursive: true });
});

describe("SQLite opportunity storage", () => {
  it("creates job and connection opportunities with type-specific details", () => {
    const job = createOpportunity({
      type: "job",
      label: "Engineering Manager",
      organization: "Acme",
      status: "wishlist",
      priority: "high",
      summary: "Platform leadership role",
      url: "https://example.com/job",
      source: "Acme careers",
      location: "Example City",
      contact: "Maya Chen",
      appliedDate: null,
      originOpportunityId: null
    });
    const connection = createOpportunity({
      type: "connection",
      label: "Maya Chen",
      organization: "Acme",
      status: "new",
      priority: "medium",
      summary: "Met at the platform leadership meetup",
      roleContext: "VP Engineering",
      contactInfo: "maya@example.com",
      meetingContext: "Example City engineering meetup",
      relationshipStrength: "familiar"
    });

    expect(job).toMatchObject({ type: "job", label: "Engineering Manager", url: "https://example.com/job" });
    expect(connection).toMatchObject({ type: "connection", label: "Maya Chen", relationshipStrength: "familiar" });
    expect(listOpportunities()).toHaveLength(2);
  });

  it("migrates legacy applications idempotently", () => {
    const databasePath = process.env.JOBTRACKER_DB_PATH;
    if (!databasePath) throw new Error("Test database path is unavailable");

    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE applications (
        id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
        source TEXT, location TEXT, url TEXT, contact TEXT, notes TEXT, applied_date TEXT,
        follow_up_date TEXT, next_action TEXT, next_action_date TEXT,
        priority TEXT NOT NULL DEFAULT 'medium', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE application_notes (
        id TEXT PRIMARY KEY, application_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'update',
        body TEXT NOT NULL, follow_up_date TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE application_status_changes (
        id TEXT PRIMARY KEY, application_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL,
        note TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE application_artifacts (
        id TEXT PRIMARY KEY, application_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
        file_path TEXT NOT NULL, content_type TEXT NOT NULL DEFAULT 'text/markdown',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(application_id, type, file_path)
      );
    `);
    legacy.prepare(`INSERT INTO applications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("legacy-application", "Legacy Co", "Engineering Manager", "interviewing", "Referral", "Example City", "https://example.com/job", "Maya Chen", "Legacy summary", "2026-07-01", null, "Send portfolio", "2026-07-15", "high", "2026-07-01T12:00:00.000Z", "2026-07-02T12:00:00.000Z");
    legacy.prepare(`INSERT INTO application_notes VALUES (?, ?, ?, ?, ?, ?)`)
      .run("legacy-follow-up", "legacy-application", "follow_up", "Follow up with recruiter", "2026-07-18", "2026-07-03T12:00:00.000Z");
    legacy.prepare(`INSERT INTO application_notes VALUES (?, ?, ?, ?, ?, ?)`)
      .run("legacy-note", "legacy-application", "update", "Portfolio requested", null, "2026-07-04T12:00:00.000Z");
    legacy.prepare(`INSERT INTO application_status_changes VALUES (?, ?, ?, ?, ?, ?)`)
      .run("legacy-status", "legacy-application", "applied", "interviewing", "Screen booked", "2026-07-05T12:00:00.000Z");
    legacy.prepare(`INSERT INTO application_artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("legacy-artifact", "legacy-application", "resume", "Resume", "/tmp/resume.pdf", "application/pdf", "2026-07-01T12:00:00.000Z", "2026-07-01T12:00:00.000Z");
    legacy.close();

    const detail = getOpportunityDetail("legacy-application");
    expect(detail).toMatchObject({
      id: "legacy-application", type: "job", label: "Engineering Manager",
      organization: "Legacy Co", status: "interviewing"
    });
    expect(detail?.activities.map((activity) => activity.type)).toEqual([
      "opportunity_created", "status_change", "note", "note", "status_change"
    ]);
    expect(detail?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Send portfolio", dueDate: "2026-07-15", state: "open" }),
      expect.objectContaining({ title: "Follow up with recruiter", dueDate: "2026-07-18", state: "open" })
    ]));
    expect(detail?.artifacts[0]).toMatchObject({ id: "legacy-artifact", type: "resume" });

    resetStorageForTests();
    const rerun = getOpportunityDetail("legacy-application");
    expect(listOpportunities()).toHaveLength(1);
    expect(rerun?.activities).toHaveLength(5);
    expect(rerun?.tasks).toHaveLength(2);
    expect(rerun?.artifacts).toHaveLength(1);
  });

  it("retains terminal follow-ups and next actions while preserving follow-up activities", () => {
    const databasePath = process.env.JOBTRACKER_DB_PATH!;
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE applications (id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, source TEXT, location TEXT, url TEXT, contact TEXT, notes TEXT, applied_date TEXT, follow_up_date TEXT, next_action TEXT, next_action_date TEXT, priority TEXT NOT NULL DEFAULT 'medium', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE application_notes (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL, follow_up_date TEXT, created_at TEXT NOT NULL);
    `);
    legacy.prepare(`INSERT INTO applications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("terminal", "Acme", "Engineer", "archived", null, null, null, null, null, null, null, "Send portfolio", "2026-07-15", "medium", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    legacy.prepare(`INSERT INTO application_notes VALUES (?, ?, ?, ?, ?, ?)`)
      .run("terminal-follow-up", "terminal", "follow_up", "Follow up with recruiter", "2026-07-18", "2026-07-02T00:00:00.000Z");
    legacy.close();

    const detail = getOpportunityDetail("terminal");

    expect(detail?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Send portfolio", dueDate: "2026-07-15" }),
      expect.objectContaining({ title: "Follow up with recruiter", dueDate: "2026-07-18" })
    ]));
    expect(detail?.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "terminal-follow-up", type: "note", body: "Follow up with recruiter" })
    ]));
  });

  it("normalizes migrated next-action and follow-up task pairs before deduplicating", () => {
    const databasePath = process.env.JOBTRACKER_DB_PATH!;
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE applications (id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, source TEXT, location TEXT, url TEXT, contact TEXT, notes TEXT, applied_date TEXT, follow_up_date TEXT, next_action TEXT, next_action_date TEXT, priority TEXT NOT NULL DEFAULT 'medium', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE application_notes (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL, follow_up_date TEXT, created_at TEXT NOT NULL);
    `);
    legacy.prepare(`INSERT INTO applications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("dedupe", "Acme", "Engineer", "applied", null, null, null, null, null, null, null, " Send Portfolio ", "2026-07-15", "medium", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    legacy.prepare(`INSERT INTO application_notes VALUES (?, ?, ?, ?, ?, ?)`)
      .run("dedupe-follow-up", "dedupe", "follow_up", "send   portfolio", "2026-07-15", "2026-07-02T00:00:00.000Z");
    legacy.close();

    expect(getOpportunityDetail("dedupe")?.tasks).toHaveLength(1);
  });

  it("rolls back migration writes when a legacy artifact cannot be copied", () => {
    const db = new Database(process.env.JOBTRACKER_DB_PATH!);
    db.exec(`
      CREATE TABLE applications (id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, source TEXT, location TEXT, url TEXT, contact TEXT, notes TEXT, applied_date TEXT, follow_up_date TEXT, next_action TEXT, next_action_date TEXT, priority TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE application_artifacts (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, file_path TEXT NOT NULL, content_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO applications VALUES ('rollback', 'Acme', 'Engineer', 'applied', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'medium', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
      INSERT INTO application_artifacts VALUES ('rollback-artifact', 'rollback', 'resume', 'Resume', '/tmp/resume.pdf', 'application/pdf', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
    `);
    ensureOpportunitySchema(db);
    db.exec("CREATE TRIGGER fail_artifact BEFORE INSERT ON opportunity_artifacts BEGIN SELECT RAISE(ABORT, 'artifact failure'); END;");

    expect(() => migrateLegacyApplications(db)).toThrow("artifact failure");
    expect(db.prepare("SELECT COUNT(*) AS count FROM opportunities").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT value FROM schema_metadata WHERE key = 'opportunity_schema_version'").get()).toBeUndefined();
    db.close();
  });

  it("creates linked jobs atomically when connection activity insertion fails", () => {
    const connection = createOpportunity({ type: "connection", label: "Maya", status: "new" });
    const db = new Database(process.env.JOBTRACKER_DB_PATH!);
    db.exec("CREATE TRIGGER fail_link BEFORE INSERT ON opportunity_activities WHEN NEW.type = 'linked_job_created' BEGIN SELECT RAISE(ABORT, 'link failure'); END;");
    db.close();

    expect(() => createLinkedJobOpportunity(connection.id, { type: "job", label: "Engineer", status: "wishlist" })).toThrow("link failure");
    expect(getOpportunityDetail(connection.id)?.originatedJobs).toHaveLength(0);
  });

  it("validates updated job origins and rejects archiving an origin connection", () => {
    const connection = createOpportunity({ type: "connection", label: "Maya", status: "new" });
    const job = createOpportunity({ type: "job", label: "Engineer", status: "wishlist" });

    expect(() => updateOpportunity(job.id, { type: "job", label: "Engineer", status: "wishlist", originOpportunityId: "missing" })).toThrow(/origin/i);
    expect(updateOpportunity(job.id, { type: "job", label: "Engineer", status: "wishlist", originOpportunityId: connection.id })?.originOpportunityId).toBe(connection.id);
    expect(() => changeOpportunityStatus(connection.id, "archived")).toThrow(/origin/i);
    expect(() => updateOpportunity(connection.id, { type: "connection", label: "Maya", status: "archived" })).toThrow(/origin/i);
  });

  it("requires strict ISO activity timestamps and records status and task lifecycle activities", () => {
    const job = createOpportunity({ type: "job", label: "Engineer", status: "applied" });
    expect(() => addOpportunityActivity(job.id, { type: "note", body: "Hello", occurredAt: "July 15, 2026" })).toThrow(/occurrence/i);
    addOpportunityActivity(job.id, { type: "note", body: "Hello", occurredAt: "2026-07-15T12:00:00.000Z" });
    changeOpportunityStatus(job.id, "interviewing", "Screen booked");
    updateOpportunity(job.id, { type: "job", label: "Engineer", status: "offer" });
    const taskId = createOpportunityTask(job.id, { title: "Send portfolio", dueDate: "2026-07-16" }).tasks[0]!.id;
    updateOpportunityTask(job.id, taskId, { dueDate: "2026-07-17" });
    updateOpportunityTask(job.id, taskId, { state: "completed" });

    expect(getOpportunityDetail(job.id)?.activities.map((activity) => activity.type)).toEqual(expect.arrayContaining([
      "status_change", "task_created", "task_rescheduled", "task_completed"
    ]));
    expect(getOpportunityDetail(job.id)?.activities.filter((activity) => activity.type === "status_change")).toHaveLength(2);
  });

  it("rejects invalid subtype, status, date, and non-job artifact input", () => {
    const connection = createOpportunity({ type: "connection", label: "Maya", status: "new" });
    expect(() => createOpportunity({ type: "job", label: "Engineer", status: "new" as "wishlist" })).toThrow(/status/i);
    expect(() => createOpportunity({ type: "connection", label: "Maya", status: "new", url: "https://example.com" } as never)).toThrow(/job fields/i);
    expect(() => createOpportunity({ type: "job", label: "Engineer", status: "wishlist", appliedDate: "07/15/2026" })).toThrow(/yyyy-mm-dd/i);
    expect(() => upsertOpportunityArtifact(connection.id, { type: "resume", title: "Resume", filePath: "/tmp/resume.pdf" })).toThrow(/job opportunities/i);
  });
});
