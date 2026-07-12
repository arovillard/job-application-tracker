import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createOpportunity,
  getOpportunityDetail,
  listOpportunities,
  resetStorageForTests
} from "./storage";

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
      "opportunity_created", "status_change", "note", "status_change"
    ]);
    expect(detail?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Send portfolio", dueDate: "2026-07-15", state: "open" }),
      expect.objectContaining({ title: "Follow up with recruiter", dueDate: "2026-07-18", state: "open" })
    ]));
    expect(detail?.artifacts[0]).toMatchObject({ id: "legacy-artifact", type: "resume" });

    resetStorageForTests();
    const rerun = getOpportunityDetail("legacy-application");
    expect(listOpportunities()).toHaveLength(1);
    expect(rerun?.activities).toHaveLength(4);
    expect(rerun?.tasks).toHaveLength(2);
    expect(rerun?.artifacts).toHaveLength(1);
  });
});
