import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireDailyJobPrepLock, LOCK_TTL_MS, releaseDailyJobPrepLock } from "./lib/daily-job-prep-lock.mjs";
import { initializeDatabaseIdentity } from "./lib/jobtracker-database-identity.mjs";
import { ensureOpportunitySchema } from "./lib/opportunity-schema.mjs";

const projectRoot = path.resolve(__dirname, "..");
const timestamp = "2026-01-01T00:00:00.000Z";
const requiredArtifacts = [
  ["resume", "Resume"],
  ["fit_analysis", "Fit Analysis"],
  ["cover_letter", "Cover Letter"],
  ["outreach_message", "Outreach Message"],
  ["other", "Submission Guide"]
] as const;

let directory: string;
let databasePath: string;
let applicationsDirectory: string;
let identity: string;
let token: string;

function criterion(id: string, weight: number, evidence = "direct", mandatory = false) {
  return {
    id,
    requirement: `${id} requirement`,
    mandatory,
    evidence,
    evidenceText: evidence === "unsupported" ? "" : `${id} evidence`,
    rationale: `${id} rationale`,
    weight
  };
}

function assessment(state = "open") {
  return {
    schemaVersion: 1,
    posting: {
      url: "https://example.com/jobs/engineering-manager#top",
      organization: "Example Co",
      role: "Engineering Manager",
      source: "Example",
      state,
      location: "Remote",
      evaluatedAt: "2026-07-22T00:00:00.000Z"
    },
    groups: [
      { name: "required_qualifications", criteria: [criterion("required", 50, "direct", true)] },
      { name: "seniority_leadership", criteria: [criterion("seniority", 20)] },
      { name: "technical_domain", criteria: [criterion("technical", 15)] },
      { name: "product_delivery_customer", criteria: [criterion("product", 10)] },
      { name: "logistics_employment", criteria: [criterion("logistics", 5)] }
    ],
    blockers: []
  };
}

function exact79Assessment() {
  const value = assessment();
  value.groups[0].criteria = [criterion("required-mandatory", 40, "direct", true), criterion("required-other", 10, "unsupported")];
  value.groups[2].criteria = [criterion("technical-direct", 14), criterion("technical-missing", 1, "unsupported")];
  value.groups[3].criteria = [criterion("product-missing", 10, "unsupported")];
  return value;
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    assessment: assessment(),
    posting: {
      company: " Example Co ",
      role: "Engineering Manager",
      url: "https://example.com/jobs/engineering-manager",
      source: "Example",
      location: "Remote",
      posting_state: "open",
      ...overrides
    }
  };
}

function run(payload: unknown, options: { identity?: string; token?: string; extras?: string[] } = {}) {
  return spawnSync(process.execPath, [
    "scripts/prepare-qualified-job.mjs",
    "--db", databasePath,
    "--expected-database-id", options.identity || identity,
    "--lock-token", options.token || token,
    "--input-json", "-",
    ...(options.extras || [])
  ], { cwd: projectRoot, encoding: "utf8", input: JSON.stringify(payload) });
}

function upsert(args: string[]) {
  const result = spawnSync(process.execPath, ["scripts/upsert-job-posting.mjs", "--db", databasePath, ...args], { cwd: projectRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

function seedExisting(status = "wishlist", url = "https://example.com/jobs/engineering-manager") {
  return upsert([
    "--company", "Example Co",
    "--role", "Engineering Manager",
    "--url", url,
    "--source", "Example",
    "--location", "Remote",
    "--status", status,
    "--posting-state", status === "archived" || status === "rejected" ? "closed" : "open"
  ]);
}

function registerCompleteDossier(opportunityId: string) {
  const files: string[] = [];
  const db = new Database(databasePath);
  for (const [type, title] of requiredArtifacts) {
    const filePath = path.join(applicationsDirectory, `${type}.md`);
    writeFileSync(filePath, `${type}:${title}`);
    files.push(filePath);
    db.prepare("INSERT INTO opportunity_artifacts VALUES (?, ?, ?, ?, ?, 'text/markdown', ?, ?)").run(`${type}-id`, opportunityId, type, title, filePath, timestamp, timestamp);
  }
  db.close();
  return files;
}

function snapshotFiles(files: string[]) {
  return files.map((filePath) => ({ filePath, bytes: readFileSync(filePath), mtime: statSync(filePath).mtimeMs }));
}

function expectFilesUnchanged(snapshots: ReturnType<typeof snapshotFiles>) {
  for (const snapshot of snapshots) {
    expect(readFileSync(snapshot.filePath)).toEqual(snapshot.bytes);
    expect(statSync(snapshot.filePath).mtimeMs).toBe(snapshot.mtime);
  }
}

function databaseSnapshot() {
  return { bytes: readFileSync(databasePath), mtime: statSync(databasePath).mtimeMs };
}

function expectDatabaseUnchanged(snapshot: ReturnType<typeof databaseSnapshot>) {
  expect(readFileSync(databasePath)).toEqual(snapshot.bytes);
  expect(statSync(databasePath).mtimeMs).toBe(snapshot.mtime);
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "qualified-intake-"));
  applicationsDirectory = path.join(directory, "applications");
  mkdirSync(applicationsDirectory);
  databasePath = path.join(directory, "tracker.sqlite");
  const db = new Database(databasePath);
  ensureOpportunitySchema(db);
  db.close();
  identity = initializeDatabaseIdentity(databasePath).instanceId;
  token = acquireDailyJobPrepLock(databasePath).token;
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("prepare-qualified-job", () => {
  it("returns skip_ineligible for an exact 79 before dry-run and leaves tracker state unchanged", () => {
    const payload = input();
    payload.assessment = exact79Assessment();
    const before = databaseSnapshot();

    const result = run(payload);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      decision: "skip_ineligible",
      evaluation: { overallScore: 79, mandatoryMatch: 100, seniorityMatch: 100, eligible: false },
      opportunity: null,
      dossier: null,
      preparationPrecondition: null
    });
    expectDatabaseUnchanged(before);
  });

  it.each(["rejected", "archived"])("returns skip_inactive without touching a %s record or files", (status) => {
    const created = seedExisting(status);
    const filePath = path.join(applicationsDirectory, "unrelated.md");
    writeFileSync(filePath, "unchanged");
    const files = snapshotFiles([filePath]);
    const before = databaseSnapshot();

    const result = run(input());

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ decision: "skip_inactive", opportunity: { id: created.opportunity.id, status } });
    expectDatabaseUnchanged(before);
    expectFilesUnchanged(files);
  });

  it("returns skip_complete for an unchanged five-file dossier without changing database or files", () => {
    const created = seedExisting();
    const files = snapshotFiles(registerCompleteDossier(created.opportunity.id));
    const before = databaseSnapshot();

    const result = run(input());

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ decision: "skip_complete", dossier: { complete: true }, preparationPrecondition: null });
    expectDatabaseUnchanged(before);
    expectFilesUnchanged(files);
  });

  it("returns repair_dossier for an unchanged incomplete dossier and preserves valid files", () => {
    const created = seedExisting();
    const allFiles = registerCompleteDossier(created.opportunity.id);
    const db = new Database(databasePath);
    db.prepare("DELETE FROM opportunity_artifacts WHERE type='cover_letter'").run();
    db.close();
    const validFiles = snapshotFiles(allFiles.filter((filePath) => !filePath.endsWith("cover_letter.md")));
    const before = databaseSnapshot();

    const result = run(input());

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      decision: "repair_dossier",
      dossier: { complete: false },
      preparationPrecondition: { opportunityId: created.opportunity.id, status: "wishlist", updatedAt: expect.any(String) }
    });
    expectDatabaseUnchanged(before);
    expectFilesUnchanged(validFiles);
  });

  it("returns prepare_dossier and creates one wishlist row for a new eligible posting", () => {
    const result = run(input());

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      schemaVersion: 1,
      decision: "prepare_dossier",
      opportunity: { organization: "Example Co", label: "Engineering Manager", status: "wishlist", url: "https://example.com/jobs/engineering-manager" },
      preparationPrecondition: { opportunityId: output.opportunity.id, status: "wishlist", updatedAt: output.opportunity.updatedAt }
    });
    const db = new Database(databasePath, { readonly: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM opportunities WHERE type='job'").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT type FROM opportunity_activities WHERE opportunity_id=? ORDER BY created_at,id").all(output.opportunity.id)).toHaveLength(2);
    db.close();
  });

  it("returns prepare_dossier through guarded CAS for a materially changed existing posting", () => {
    const created = seedExisting("wishlist", "https://example.com/jobs/old");
    const beforeDb = new Database(databasePath, { readonly: true });
    const beforeActivities = beforeDb.prepare("SELECT COUNT(*) AS count FROM opportunity_activities WHERE opportunity_id=?").get(created.opportunity.id) as { count: number };
    beforeDb.close();

    const result = run(input());

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      decision: "prepare_dossier",
      opportunity: { id: created.opportunity.id, status: "wishlist", url: "https://example.com/jobs/engineering-manager" },
      preparationPrecondition: { opportunityId: created.opportunity.id, status: "wishlist", updatedAt: output.opportunity.updatedAt }
    });
    const db = new Database(databasePath, { readonly: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM opportunity_activities WHERE opportunity_id=?").get(created.opportunity.id)).toEqual({ count: beforeActivities.count + 1 });
    expect(db.prepare("SELECT body FROM opportunity_activities WHERE opportunity_id=? ORDER BY created_at DESC,id DESC LIMIT 1").get(created.opportunity.id)).toEqual(expect.objectContaining({ body: expect.stringContaining("changes:") }));
    db.close();
  });

  it("fails without mutation when the live database identity differs", () => {
    const before = databaseSnapshot();
    const result = run(input(), { identity: "00000000-0000-4000-8000-000000000000" });
    expect(result.status).toBe(1);
    expectDatabaseUnchanged(before);
  });

  it("fails without mutation when the run token is wrong", () => {
    const before = databaseSnapshot();
    const result = run(input(), { token: "00000000-0000-4000-8000-000000000000" });
    expect(result.status).toBe(1);
    expectDatabaseUnchanged(before);
  });

  it("fails without mutation when the run token is expired", () => {
    releaseDailyJobPrepLock(databasePath, token);
    token = acquireDailyJobPrepLock(databasePath, Date.now() - LOCK_TTL_MS - 1).token;
    const before = databaseSnapshot();
    const result = run(input());
    expect(result.status).toBe(1);
    expectDatabaseUnchanged(before);
  });

  it.each([
    ["company", { company: "Wrong Co" }],
    ["role", { role: "Director of Engineering" }],
    ["url", { url: "https://example.com/jobs/other" }]
  ])("rejects a mismatched %s before dry-run", (_field, override) => {
    const before = databaseSnapshot();
    expect(run(input(override)).status).toBe(1);
    expectDatabaseUnchanged(before);
  });

  it.each(["closed", "unknown"])("rejects evaluated open with intake %s before dry-run", (postingState) => {
    const before = databaseSnapshot();
    expect(run(input({ posting_state: postingState })).status).toBe(1);
    expectDatabaseUnchanged(before);
  });

  it("rejects submit, credential, and authenticated-action input or CLI options before mutation", () => {
    const before = databaseSnapshot();
    const rootSubmit = { ...input(), submit: true };
    const postingCredentials = input();
    (postingCredentials.posting as Record<string, unknown>).credentials = { token: "secret" };
    expect(run(rootSubmit).status).toBe(1);
    expect(run(postingCredentials).status).toBe(1);
    expect(run(input(), { extras: ["--submit"] }).status).toBe(1);
    expectDatabaseUnchanged(before);
  });

  it.each(["applied", "interviewing", "offer"])("does not prepare materials for a non-wishlist %s record", (status) => {
    seedExisting(status);
    const filePath = path.join(applicationsDirectory, `${status}.md`);
    writeFileSync(filePath, status);
    const files = snapshotFiles([filePath]);
    const before = databaseSnapshot();
    const result = run(input());
    expect(result.status).toBe(1);
    expectDatabaseUnchanged(before);
    expectFilesUnchanged(files);
  });
});
