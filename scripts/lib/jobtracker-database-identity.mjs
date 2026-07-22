import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import path from "node:path";
import { assertCurrentOpportunitySchema } from "./current-opportunity-schema.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function assertFile(databasePath) { if (!path.isAbsolute(databasePath)) throw new Error("database path must be absolute"); let stat; try { stat = lstatSync(databasePath); } catch { throw new Error("database file must exist"); } if (!stat.isFile()) throw new Error("database path must be a regular file"); }
function assertUuid(value, message = "database identity is invalid") { if (typeof value !== "string" || !UUID.test(value)) throw new Error(message); return value.toLowerCase(); }
export function initializeDatabaseIdentity(databasePath) {
  assertFile(databasePath); const db = new Database(databasePath, { fileMustExist: true });
  try { assertCurrentOpportunitySchema(db); const result = db.transaction(() => { const row = db.prepare("SELECT value FROM schema_metadata WHERE key = 'jobtracker_instance_id'").get(); if (row) return { action: "existing", instanceId: assertUuid(row.value) }; const instanceId = randomUUID(); db.prepare("INSERT INTO schema_metadata (key, value) VALUES ('jobtracker_instance_id', ?)").run(instanceId); return { action: "initialized", instanceId }; })(); return { schemaVersion: 1, ...result, databasePath }; } finally { db.close(); }
}
export function verifyDatabaseIdentity(databasePath, expectedId) {
  assertFile(databasePath); const expected = assertUuid(expectedId, "expected identity is invalid"); const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try { assertCurrentOpportunitySchema(db); const row = db.prepare("SELECT value FROM schema_metadata WHERE key = 'jobtracker_instance_id'").get(); if (!row) throw new Error("database identity is missing"); const instanceId = assertUuid(row.value); if (instanceId !== expected) throw new Error("database identity does not match"); return { schemaVersion: 1, action: "verified", databasePath, instanceId }; } finally { db.close(); }
}
