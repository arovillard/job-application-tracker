import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { ensureOpportunitySchema } from "./lib/opportunity-schema.mjs";
import { initializeDatabaseIdentity, verifyDatabaseIdentity } from "./lib/jobtracker-database-identity.mjs";

const directories: string[] = [];
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "jobtracker-identity-"));
  directories.push(directory);
  const databasePath = path.join(directory, "tracker.sqlite");
  const db = new Database(databasePath);
  ensureOpportunitySchema(db);
  db.close();
  return databasePath;
}
afterEach(() => { while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true }); });

describe("jobtracker database identity", () => {
  it("initializes one stable UUID only in an existing valid tracker database", () => {
    const databasePath = fixture();
    const first = initializeDatabaseIdentity(databasePath);
    const second = initializeDatabaseIdentity(databasePath);
    expect(first).toMatchObject({ schemaVersion: 1, action: "initialized", databasePath });
    expect(second).toMatchObject({ schemaVersion: 1, action: "existing", instanceId: first.instanceId });
    expect(first.instanceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const db = new Database(databasePath, { readonly: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM schema_metadata WHERE key='jobtracker_instance_id'").get()).toEqual({ count: 1 });
    db.close();
  });

  it("verifies the exact initialized identity read-only", () => {
    const databasePath = fixture(); const identity = initializeDatabaseIdentity(databasePath);
    const bytes = readFileSync(databasePath); const mtime = statSync(databasePath).mtimeMs;
    expect(verifyDatabaseIdentity(databasePath, identity.instanceId)).toMatchObject({ action: "verified", instanceId: identity.instanceId });
    expect(readFileSync(databasePath)).toEqual(bytes); expect(statSync(databasePath).mtimeMs).toBe(mtime);
  });

  it("rejects a missing database without creating it", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "jobtracker-identity-")); directories.push(directory);
    const databasePath = path.join(directory, "absent.sqlite");
    expect(() => initializeDatabaseIdentity(databasePath)).toThrow();
    expect(() => statSync(databasePath)).toThrow();
  });
  it("rejects a directory path", () => { const databasePath = fixture(); expect(() => initializeDatabaseIdentity(path.dirname(databasePath))).toThrow(/regular file/i); });
  it("rejects a valid SQLite file without tracker tables", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "jobtracker-identity-")); directories.push(directory); const databasePath = path.join(directory, "empty.sqlite"); new Database(databasePath).close();
    expect(() => initializeDatabaseIdentity(databasePath)).toThrow(/required table/i);
  });
  it("rejects a lookalike schema before identity mutation", () => {
    const databasePath = fixture(); const db = new Database(databasePath);
    db.exec("DROP INDEX opportunities_updated_at_idx; CREATE INDEX opportunities_updated_at_idx ON opportunities(updated_at ASC)"); db.close();
    expect(() => initializeDatabaseIdentity(databasePath)).toThrow(/index/i);
    const read = new Database(databasePath, { readonly: true }); expect(read.prepare("SELECT value FROM schema_metadata WHERE key='jobtracker_instance_id'").get()).toBeUndefined(); read.close();
  });
  it("rejects a tracker database without an initialized identity in verify mode", () => expect(() => verifyDatabaseIdentity(fixture(), "00000000-0000-4000-8000-000000000000")).toThrow(/identity/i));
  it("rejects a different expected UUID", () => { const id = initializeDatabaseIdentity(fixture()); expect(() => verifyDatabaseIdentity(id.databasePath, "00000000-0000-4000-8000-000000000000")).toThrow(/does not match/i); });
  it("rejects a relative database path", () => expect(() => initializeDatabaseIdentity("tracker.sqlite")).toThrow(/absolute/i));
});
