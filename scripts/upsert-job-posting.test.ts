import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tempDir: string;
let dbPath: string;

function runUpsert(args: string[]) {
  const output = execFileSync(process.execPath, ["scripts/upsert-job-posting.mjs", "--db", dbPath, ...args], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8"
  });

  return JSON.parse(output) as {
    action: "created" | "updated";
    dryRun: boolean;
    application: {
      company: string;
      role: string;
      status: string;
      source: string | null;
      location: string | null;
      url: string | null;
      notes: string | null;
      followUpDate: string | null;
    };
    changes: string[];
    noteIds: string[];
    followUpNoteId: string | null;
  };
}

function readCount(table: string) {
  const db = new Database(dbPath);
  try {
    return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  } finally {
    db.close();
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-upsert-"));
  dbPath = path.join(tempDir, "jobtracker.sqlite");
});

afterEach(() => {
  rmSync(tempDir, { force: true, recursive: true });
});

describe("upsert-job-posting CLI", () => {
  it("creates a wishlist application record with an update note and follow-up note", () => {
    const result = runUpsert([
      "--company",
      " Example Co ",
      "--role",
      " Engineering Manager ",
      "--url",
      "https://www.example.com/jobs/123",
      "--location",
      " Remote ",
      "--summary",
      " Leads a product engineering team. ",
      "--posting-state",
      "open",
      "--follow-up-date",
      "2026-07-20"
    ]);

    expect(result).toMatchObject({
      action: "created",
      dryRun: false,
      application: {
        company: "Example Co",
        role: "Engineering Manager",
        status: "wishlist",
        source: "example.com",
        location: "Remote",
        url: "https://www.example.com/jobs/123",
        notes: "Leads a product engineering team.",
        followUpDate: "2026-07-20"
      },
      changes: ["created new application record"]
    });
    expect(result.noteIds).toHaveLength(1);
    expect(result.followUpNoteId).toEqual(expect.any(String));
    expect(readCount("applications")).toBe(1);
    expect(readCount("application_notes")).toBe(2);
    expect(readCount("application_status_changes")).toBe(1);
  });

  it("updates an existing company and role instead of creating a duplicate", () => {
    runUpsert([
      "--company",
      "Example Co",
      "--role",
      "Engineering Manager",
      "--url",
      "https://example.com/jobs/old",
      "--summary",
      "Original summary.",
      "--posting-state",
      "open"
    ]);

    const updated = runUpsert([
      "--company",
      " example co ",
      "--role",
      "Engineering   Manager",
      "--url",
      "https://example.com/jobs/new",
      "--source",
      "Example Careers",
      "--location",
      "Hybrid",
      "--summary",
      "Replacement summary should not overwrite by default.",
      "--posting-state",
      "open"
    ]);

    expect(updated.action).toBe("updated");
    expect(updated.application).toMatchObject({
      company: "Example Co",
      role: "Engineering Manager",
      source: "Example Careers",
      location: "Hybrid",
      url: "https://example.com/jobs/new",
      notes: "Original summary."
    });
    expect(updated.changes).toEqual([
      "source: example.com -> Example Careers",
      "location: blank -> Hybrid",
      "url: https://example.com/jobs/old -> https://example.com/jobs/new"
    ]);
    expect(readCount("applications")).toBe(1);
    expect(readCount("application_notes")).toBe(2);
  });

  it("does not persist records when dry-run is requested", () => {
    const result = runUpsert([
      "--company",
      "Dry Run Co",
      "--role",
      "Staff Engineer",
      "--url",
      "https://example.com/jobs/dry-run",
      "--posting-state",
      "open",
      "--dry-run"
    ]);

    expect(result).toMatchObject({
      action: "created",
      dryRun: true,
      application: {
        company: "Dry Run Co",
        role: "Staff Engineer"
      }
    });
    expect(readCount("applications")).toBe(0);
  });
});
