import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commitJobDossier } from "./commit-job-dossier.mjs";
import { acquireDailyJobPrepLock } from "./lib/daily-job-prep-lock.mjs";
import { ensureOpportunitySchema } from "./lib/opportunity-schema.mjs";
import { registerApplicationArtifact } from "./register-application-artifact.mjs";

const timestamp = "2026-01-01T00:00:00.000Z";
const requirements = [
  { key: "resume", type: "resume", title: "Resume" },
  { key: "fit_analysis", type: "fit_analysis", title: "Fit Analysis" },
  { key: "cover_letter", type: "cover_letter", title: "Cover Letter" },
  { key: "outreach_message", type: "outreach_message", title: "Outreach Message" },
  { key: "submission_guide", type: "other", title: "Submission Guide" }
] as const;

type Context = {
  root: string;
  databasePath: string;
  applicationsDirectory: string;
  stagingDirectory: string;
};

type ManifestEntry = {
  key: string;
  stagedFile: string;
  destinationFile: string;
  contentType: string;
};

const roots: string[] = [];

function fixture(): Context {
  const root = mkdtempSync(path.join(tmpdir(), "dossier-commit-"));
  roots.push(root);
  const databasePath = path.join(root, "tracker.sqlite");
  const applicationsDirectory = path.join(root, "applications");
  const stagingDirectory = path.join(applicationsDirectory, ".staging");
  mkdirSync(stagingDirectory, { recursive: true });
  const db = new Database(databasePath);
  ensureOpportunitySchema(db);
  db.prepare("INSERT INTO opportunities VALUES ('job-id','job','Role','Acme','wishlist','medium',NULL,NULL,?,?)").run(timestamp, timestamp);
  db.prepare("INSERT INTO job_opportunity_details VALUES ('job-id',NULL,NULL,NULL,NULL,NULL)").run();
  db.close();
  return { root, databasePath, applicationsDirectory, stagingDirectory };
}

function updatedAt(context: Context) {
  const db = new Database(context.databasePath, { readonly: true });
  try {
    return (db.prepare("SELECT updated_at FROM opportunities WHERE id='job-id'").get() as { updated_at: string }).updated_at;
  } finally {
    db.close();
  }
}

function rows(context: Context) {
  const db = new Database(context.databasePath, { readonly: true });
  try {
    return db.prepare("SELECT type,title,file_path FROM opportunity_artifacts WHERE opportunity_id='job-id' ORDER BY type,title,file_path").all() as { type: string; title: string; file_path: string }[];
  } finally {
    db.close();
  }
}

function stagedEntries(context: Context, keys = requirements.map((item) => item.key)): ManifestEntry[] {
  return keys.map((key) => {
    const stagedFile = path.join(context.stagingDirectory, `${key}.md`);
    const destinationFile = path.join(context.applicationsDirectory, `${key}.md`);
    writeFileSync(stagedFile, `staged:${key}`);
    return { key, stagedFile, destinationFile, contentType: "text/markdown" };
  });
}

function acquireOptions(context: Context, entries: ManifestEntry[]) {
  const lock = acquireDailyJobPrepLock(context.databasePath);
  return {
    db: context.databasePath,
    "opportunity-id": "job-id",
    "applications-dir": context.applicationsDirectory,
    "lock-token": lock.token,
    "expected-status": "wishlist",
    "expected-updated-at": updatedAt(context),
    manifest: { schemaVersion: 1, entries }
  };
}

function registerExisting(context: Context, key: typeof requirements[number]["key"]) {
  const requirement = requirements.find((item) => item.key === key)!;
  const filePath = path.join(context.applicationsDirectory, `existing-${key}.md`);
  writeFileSync(filePath, `existing:${key}`);
  registerApplicationArtifact({
    db: context.databasePath,
    "opportunity-id": "job-id",
    type: requirement.type,
    title: requirement.title,
    file: filePath,
    "content-type": "text/markdown"
  });
  return filePath;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("commitJobDossier", () => {
  it("is exported for guarded programmatic dossier commits", () => {
    expect(typeof commitJobDossier).toBe("function");
  });

  it("commits and registers five staged files for a new dossier", () => {
    const context = fixture();
    const entries = stagedEntries(context);

    const result = commitJobDossier(acquireOptions(context, entries));

    expect(result.complete).toBe(true);
    expect(rows(context)).toHaveLength(5);
    for (const entry of entries) {
      expect(readFileSync(entry.destinationFile, "utf8")).toBe(`staged:${entry.key}`);
      expect(existsSync(entry.stagedFile)).toBe(false);
    }
    expect(rows(context)).toEqual(expect.arrayContaining(requirements.map((item) => expect.objectContaining({ type: item.type, title: item.key === "submission_guide" ? item.title : item.key }))));
  });

  it("repairs only the missing output and preserves valid files byte-for-byte and mtime-for-mtime", () => {
    const context = fixture();
    const preserved = requirements.filter((item) => item.key !== "cover_letter").map((item) => registerExisting(context, item.key));
    const before = preserved.map((filePath) => ({ filePath, bytes: readFileSync(filePath), mtime: statSync(filePath).mtimeMs }));
    const entries = stagedEntries(context, ["cover_letter"]);

    const result = commitJobDossier(acquireOptions(context, entries));

    expect(result.complete).toBe(true);
    expect(rows(context)).toHaveLength(5);
    for (const snapshot of before) {
      expect(readFileSync(snapshot.filePath)).toEqual(snapshot.bytes);
      expect(statSync(snapshot.filePath).mtimeMs).toBe(snapshot.mtime);
    }
  });

  it("rejects an attempt to replace a valid requirement before file or database mutation", () => {
    const context = fixture();
    const validResume = registerExisting(context, "resume");
    const entries = stagedEntries(context, ["resume", "fit_analysis", "outreach_message", "submission_guide"]);
    const options = acquireOptions(context, entries);
    const beforeDatabase = readFileSync(context.databasePath);
    const beforeResume = readFileSync(validResume);

    expect(() => commitJobDossier(options)).toThrow(/replace valid/i);

    expect(readFileSync(context.databasePath)).toEqual(beforeDatabase);
    expect(readFileSync(validResume)).toEqual(beforeResume);
    expect(entries.every((entry) => existsSync(entry.stagedFile))).toBe(true);
    expect(entries.every((entry) => !existsSync(entry.destinationFile))).toBe(true);
  });

  it.each([
    "missing staged file",
    "duplicate key",
    "extra key",
    "escaped staged path",
    "staged symlink",
    "existing destination",
    "duplicate destination",
    "escaped destination",
    "destination parent symlink",
    "missing destination parent"
  ])("rejects %s before copying or registering", (defect) => {
    const context = fixture();
    const entries = stagedEntries(context);
    if (defect === "missing staged file") unlinkSync(entries[0].stagedFile);
    if (defect === "duplicate key") entries[1].key = entries[0].key;
    if (defect === "extra key") entries[0].key = "posting";
    if (defect === "escaped staged path") {
      entries[0].stagedFile = path.join(context.root, "outside-staged.md");
      writeFileSync(entries[0].stagedFile, "outside");
    }
    if (defect === "staged symlink") {
      unlinkSync(entries[0].stagedFile);
      const target = path.join(context.root, "symlink-target.md");
      writeFileSync(target, "target");
      symlinkSync(target, entries[0].stagedFile);
    }
    if (defect === "existing destination") writeFileSync(entries[0].destinationFile, "existing");
    if (defect === "duplicate destination") entries[1].destinationFile = entries[0].destinationFile;
    if (defect === "escaped destination") {
      const external = path.join(context.root, "external-destination");
      mkdirSync(external);
      entries[0].destinationFile = path.join(external, "resume.md");
    }
    if (defect === "destination parent symlink") {
      const external = path.join(context.root, "external-parent");
      mkdirSync(external);
      const linkedParent = path.join(context.applicationsDirectory, "linked-parent");
      symlinkSync(external, linkedParent);
      entries[0].destinationFile = path.join(linkedParent, "resume.md");
    }
    if (defect === "missing destination parent") entries[0].destinationFile = path.join(context.applicationsDirectory, "missing", "resume.md");
    const options = acquireOptions(context, entries);
    const beforeDatabase = readFileSync(context.databasePath);

    expect(() => commitJobDossier(options)).toThrow();

    expect(readFileSync(context.databasePath)).toEqual(beforeDatabase);
    expect(rows(context)).toHaveLength(0);
    for (const entry of entries) {
      if (defect !== "existing destination" || entry !== entries[0]) expect(existsSync(entry.destinationFile)).toBe(false);
    }
  });

  it("rejects an escaping staging-root symlink before inspecting or copying", () => {
    const context = fixture();
    rmSync(context.stagingDirectory, { recursive: true });
    const external = path.join(context.root, "external-staging");
    mkdirSync(external);
    symlinkSync(external, context.stagingDirectory);
    const entries = stagedEntries(context);
    const options = acquireOptions(context, entries);
    const before = readFileSync(context.databasePath);

    expect(() => commitJobDossier(options)).toThrow(/staging/i);
    expect(readFileSync(context.databasePath)).toEqual(before);
    expect(rows(context)).toHaveLength(0);
  });

  it("rejects a destination already referenced by any artifact row before copying", () => {
    const context = fixture();
    const entries = stagedEntries(context);
    const db = new Database(context.databasePath);
    db.prepare("INSERT INTO opportunity_artifacts VALUES ('collision','job-id','posting','Posting',?,'text/markdown',?,?)").run(entries[0].destinationFile, timestamp, timestamp);
    db.close();
    const options = acquireOptions(context, entries);
    const before = readFileSync(context.databasePath);

    expect(() => commitJobDossier(options)).toThrow(/already registered/i);

    expect(readFileSync(context.databasePath)).toEqual(before);
    expect(entries.every((entry) => !existsSync(entry.destinationFile))).toBe(true);
    expect(rows(context)).toHaveLength(1);
  });

  it.each(["rejected", "archived"])("removes a newly copied file when status becomes %s before registration", (status) => {
    const context = fixture();
    const entries = stagedEntries(context);
    const options = acquireOptions(context, entries);

    expect(() => commitJobDossier(options, {
      beforeRegister() {
        const db = new Database(context.databasePath);
        db.prepare("UPDATE opportunities SET status=?, updated_at='2026-01-02T00:00:00.000Z' WHERE id='job-id'").run(status);
        db.close();
      }
    })).toThrow(/status/i);

    expect(existsSync(entries[0].destinationFile)).toBe(false);
    expect(existsSync(entries[0].stagedFile)).toBe(true);
    expect(rows(context)).toHaveLength(0);
  });

  it("retains an earlier committed output when a later registration fails", () => {
    const context = fixture();
    const entries = stagedEntries(context);
    const options = acquireOptions(context, entries);
    let registrations = 0;

    expect(() => commitJobDossier(options, {
      beforeRegister() {
        registrations += 1;
        if (registrations === 2) {
          const db = new Database(context.databasePath);
          db.prepare("UPDATE opportunities SET status='rejected', updated_at='2026-01-02T00:00:00.000Z' WHERE id='job-id'").run();
          db.close();
        }
      }
    })).toThrow(/status/i);

    expect(existsSync(entries[0].destinationFile)).toBe(true);
    expect(existsSync(entries[0].stagedFile)).toBe(false);
    expect(existsSync(entries[1].destinationFile)).toBe(false);
    expect(existsSync(entries[1].stagedFile)).toBe(true);
    expect(rows(context)).toEqual([expect.objectContaining({ type: "resume", file_path: entries[0].destinationFile })]);
  });

  it("retains committed files and removes staged sources after ambiguous post-registration exceptions", () => {
    const context = fixture();
    const entries = stagedEntries(context);
    const options = acquireOptions(context, entries);

    const result = commitJobDossier(options, {
      register(registrationOptions: Record<string, string>) {
        registerApplicationArtifact(registrationOptions);
        throw new Error("ambiguous transport failure after commit");
      }
    });

    expect(result.complete).toBe(true);
    expect(rows(context)).toHaveLength(5);
    for (const entry of entries) {
      expect(existsSync(entry.destinationFile)).toBe(true);
      expect(existsSync(entry.stagedFile)).toBe(false);
    }
  });
});
