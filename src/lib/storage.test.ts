import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ApplicationInput } from "../types";
import {
  addApplicationNote,
  changeApplicationStatus,
  createApplication,
  deleteApplication,
  getApplicationDetail,
  getApplication,
  listFollowUps,
  listApplications,
  resetStorageForTests,
  upsertApplicationArtifact,
  updateApplication
} from "./storage";

let tempDir: string;

const baseInput: ApplicationInput = {
  company: "Acme",
  role: "Frontend Engineer",
  status: "applied",
  source: "Referral",
  location: "Remote",
  url: "https://example.com/jobs/frontend",
  contact: "Sam Recruiter",
  notes: "Initial screen next week",
  appliedDate: "2026-07-08",
  followUpDate: "2026-07-15"
};

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-storage-"));
  process.env.JOBTRACKER_DB_PATH = path.join(tempDir, "test.sqlite");
});

afterEach(() => {
  resetStorageForTests();
  delete process.env.JOBTRACKER_DB_PATH;
  rmSync(tempDir, { force: true, recursive: true });
});

describe("SQLite application storage", () => {
  it("creates applications, trims text, and lists newest first", () => {
    const first = createApplication({
      ...baseInput,
      company: "  Acme  ",
      role: "  Frontend Engineer  ",
      notes: "  Build hiring dashboard  "
    });
    const second = createApplication({
      ...baseInput,
      company: "Zenith",
      role: "Platform Engineer",
      status: "wishlist"
    });

    expect(first).toMatchObject({
      company: "Acme",
      role: "Frontend Engineer",
      notes: "Build hiring dashboard"
    });
    expect(listApplications().map((application) => application.id)).toEqual([second.id, first.id]);
  });

  it("searches case-insensitively across application text fields", () => {
    createApplication({ ...baseInput, company: "Northstar Labs", notes: "React role" });
    createApplication({ ...baseInput, company: "Orbit", contact: "Maya Chen" });

    expect(listApplications({ search: "northstar" })).toHaveLength(1);
    expect(listApplications({ search: "MAYA" })[0]?.company).toBe("Orbit");
    expect(listApplications({ search: "react" })[0]?.company).toBe("Northstar Labs");
  });

  it("filters by status when status is not all", () => {
    createApplication({ ...baseInput, company: "Applied Co", status: "applied" });
    createApplication({ ...baseInput, company: "Offer Co", status: "offer" });

    expect(listApplications({ status: "offer" }).map((application) => application.company)).toEqual([
      "Offer Co"
    ]);
    expect(listApplications({ status: "all" })).toHaveLength(2);
  });

  it("gets, updates, and deletes applications", () => {
    const created = createApplication(baseInput);

    expect(getApplication(created.id)?.company).toBe("Acme");

    const updated = updateApplication(created.id, {
      ...baseInput,
      company: "Acme Systems",
      status: "interviewing",
      source: ""
    });

    expect(updated).toMatchObject({
      company: "Acme Systems",
      status: "interviewing",
      source: null
    });
    expect(deleteApplication(created.id)).toBe(true);
    expect(getApplication(created.id)).toBeNull();
    expect(deleteApplication(created.id)).toBe(false);
  });

  it("persists data in the configured SQLite file", () => {
    const created = createApplication(baseInput);

    resetStorageForTests();

    expect(getApplication(created.id)?.company).toBe("Acme");
  });

  it("rejects invalid application input with clear errors", () => {
    expect(() => createApplication({ ...baseInput, company: "" })).toThrow(/company/i);
    expect(() => createApplication({ ...baseInput, role: "   " })).toThrow(/role/i);
    expect(() =>
      createApplication({ ...baseInput, status: "not-a-status" as ApplicationInput["status"] })
    ).toThrow(/status/i);
    expect(() => createApplication({ ...baseInput, appliedDate: "07/08/2026" })).toThrow(/yyyy-mm-dd/i);
  });

  it("records notes and status changes in a readable application activity history", () => {
    const created = createApplication({ ...baseInput, followUpDate: null });

    const note = addApplicationNote(created.id, "  Recruiter asked for portfolio links  ");
    const statusChange = changeApplicationStatus(
      created.id,
      "interviewing",
      "Phone screen scheduled for Friday"
    );
    const detail = getApplicationDetail(created.id);

    expect(note).toMatchObject({
      applicationId: created.id,
      type: "update",
      body: "Recruiter asked for portfolio links"
    });
    expect(statusChange).toMatchObject({
      applicationId: created.id,
      fromStatus: "applied",
      toStatus: "interviewing",
      note: "Phone screen scheduled for Friday"
    });
    expect(detail).toMatchObject({
      id: created.id,
      status: "interviewing"
    });
    expect(detail?.notes.map((item) => item.body)).toEqual([
      "Recruiter asked for portfolio links"
    ]);
    expect(detail?.statusHistory).toEqual([
      expect.objectContaining({
        fromStatus: null,
        toStatus: "applied",
        note: "Application created"
      }),
      expect.objectContaining({
        fromStatus: "applied",
        toStatus: "interviewing",
        note: "Phone screen scheduled for Friday"
      })
    ]);
    expect(detail?.activity.map((item) => item.activityType)).toEqual(["status", "note", "status"]);
  });

  it("rejects blank notes, missing applications, and no-op status changes", () => {
    const created = createApplication(baseInput);

    expect(() => addApplicationNote(created.id, "   ")).toThrow(/note/i);
    expect(() => addApplicationNote("missing", "Followed up")).toThrow(/not found/i);
    expect(() => changeApplicationStatus(created.id, "applied")).toThrow(/already applied/i);
    expect(() => changeApplicationStatus("missing", "offer")).toThrow(/not found/i);
  });

  it("stores typed notes and lists scheduled follow-up notes as the follow-up queue", () => {
    const created = createApplication({ ...baseInput, followUpDate: null });

    addApplicationNote(created.id, {
      type: "internal",
      body: "Ask about team stability"
    });
    addApplicationNote(created.id, {
      type: "follow_up",
      body: "Send portfolio links",
      followUpDate: "2026-07-20"
    });
    addApplicationNote(created.id, {
      type: "update",
      body: "Recruiter screen completed",
      followUpDate: "2026-07-21"
    });

    const detail = getApplicationDetail(created.id);
    const followUps = listFollowUps();

    expect(detail?.notes.map((note) => ({
      type: note.type,
      body: note.body,
      followUpDate: note.followUpDate
    }))).toEqual([
      {
        type: "internal",
        body: "Ask about team stability",
        followUpDate: null
      },
      {
        type: "follow_up",
        body: "Send portfolio links",
        followUpDate: "2026-07-20"
      },
      {
        type: "update",
        body: "Recruiter screen completed",
        followUpDate: null
      }
    ]);
    expect(followUps).toEqual([
      expect.objectContaining({
        applicationId: created.id,
        type: "follow_up",
        body: "Send portfolio links",
        followUpDate: "2026-07-20",
        application: expect.objectContaining({
          company: "Acme",
          role: "Frontend Engineer"
        })
      })
    ]);
  });

  it("returns the earliest typed follow-up date on application rows", () => {
    const created = createApplication({ ...baseInput, followUpDate: null });

    addApplicationNote(created.id, {
      type: "follow_up",
      body: "Later follow-up",
      followUpDate: "2026-08-10"
    });
    addApplicationNote(created.id, {
      type: "follow_up",
      body: "Sooner follow-up",
      followUpDate: "2026-07-20"
    });

    expect(getApplication(created.id)?.followUpDate).toBe("2026-07-20");
    expect(listApplications().find((application) => application.id === created.id)?.followUpDate).toBe(
      "2026-07-20"
    );
  });

  it("backfills legacy application follow-up dates into follow-up notes", () => {
    const created = createApplication({ ...baseInput, followUpDate: "2026-07-22" });
    const detail = getApplicationDetail(created.id);

    expect(detail?.followUpDate).toBe("2026-07-22");
    expect(detail?.notes).toEqual([
      expect.objectContaining({
        type: "follow_up",
        body: "Follow up",
        followUpDate: "2026-07-22"
      })
    ]);
    expect(listFollowUps()[0]).toEqual(
      expect.objectContaining({
        applicationId: created.id,
        followUpDate: "2026-07-22"
      })
    );
  });

  it("requires follow-up notes to have a valid follow-up date", () => {
    const created = createApplication({ ...baseInput, followUpDate: null });

    expect(() =>
      addApplicationNote(created.id, {
        type: "follow_up",
        body: "Send thank-you note"
      })
    ).toThrow(/follow-up date/i);
    expect(() =>
      addApplicationNote(created.id, {
        type: "follow_up",
        body: "Send thank-you note",
        followUpDate: "07/20/2026"
      })
    ).toThrow(/yyyy-mm-dd/i);
    expect(() =>
      addApplicationNote(created.id, {
        type: "not-real" as "update",
        body: "Unsupported note type"
      })
    ).toThrow(/note type/i);
  });

  it("associates Markdown artifacts with application details without duplicating content", () => {
    const created = createApplication(baseInput);
    const artifactDir = path.join(tempDir, "applications", "Acme");
    const artifactPath = path.join(artifactDir, "frontend-engineer-fit-analysis.md");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      artifactPath,
      [
        "# Acme - Frontend Engineer Fit Analysis",
        "",
        "## Areas Where I Am Well-Qualified",
        "",
        "- Built production React workflows."
      ].join("\n")
    );

    const artifact = upsertApplicationArtifact(created.id, {
      type: "fit_analysis",
      title: "Fit Analysis",
      filePath: artifactPath,
      contentType: "text/markdown"
    });
    const detail = getApplicationDetail(created.id);

    expect(artifact).toMatchObject({
      applicationId: created.id,
      type: "fit_analysis",
      title: "Fit Analysis",
      filePath: artifactPath,
      contentType: "text/markdown"
    });
    expect(detail?.artifacts).toEqual([
      expect.objectContaining({
        id: artifact.id,
        type: "fit_analysis",
        title: "Fit Analysis",
        content: expect.stringContaining("## Areas Where I Am Well-Qualified"),
        readError: null
      })
    ]);

    writeFileSync(artifactPath, "# Updated Fit Analysis\n\nUpdated from the file.");

    expect(getApplicationDetail(created.id)?.artifacts[0]?.content).toContain(
      "Updated from the file."
    );
  });
});
