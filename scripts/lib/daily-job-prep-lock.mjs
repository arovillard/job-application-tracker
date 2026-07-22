import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import path from "node:path";
import { assertCurrentOpportunitySchema } from "./current-opportunity-schema.mjs";
export const LOCK_TTL_MS = 6 * 60 * 60 * 1000;
export const LOCK_METADATA_KEY = "daily_job_prep_lock";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function assertFile(databasePath) {
  if (!path.isAbsolute(databasePath)) throw new Error("database path must be absolute");
  let stat;
  try { stat = lstatSync(databasePath); } catch { throw new Error("database file must exist"); }
  if (!stat.isFile()) throw new Error("database path must be a regular file");
}
function parse(row) {
  if (!row) return null;
  let lock;
  try { lock = JSON.parse(row.value); } catch { throw new Error("malformed daily job prep lock"); }
  const keys = ["schemaVersion", "token", "acquiredAt", "expiresAt"];
  if (!lock || Object.keys(lock).length !== keys.length || !keys.every((key) => Object.hasOwn(lock, key)) || lock.schemaVersion !== 1 || !UUID.test(lock.token) || !Number.isSafeInteger(lock.acquiredAt) || !Number.isSafeInteger(lock.expiresAt) || lock.expiresAt - lock.acquiredAt !== LOCK_TTL_MS) throw new Error("malformed daily job prep lock");
  return lock;
}
function open(databasePath, readonly = false) { assertFile(databasePath); return new Database(databasePath, { fileMustExist: true, ...(readonly ? { readonly: true } : {}) }); }
function read(db) { return parse(db.prepare("SELECT value FROM schema_metadata WHERE key = ?").get(LOCK_METADATA_KEY)); }
function rollback(db) { try { db.exec("ROLLBACK"); } catch {} }
export function acquireDailyJobPrepLock(databasePath, now = Date.now()) {
  const db = open(databasePath);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      assertCurrentOpportunitySchema(db);
      const current = read(db);
      if (current && current.expiresAt > now) throw new Error("daily job prep lock is already held");
      const lock = { schemaVersion: 1, token: randomUUID(), acquiredAt: now, expiresAt: now + LOCK_TTL_MS };
      db.prepare("INSERT INTO schema_metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(LOCK_METADATA_KEY, JSON.stringify(lock));
      db.exec("COMMIT");
      return { schemaVersion: 1, action: current ? "recovered" : "acquired", databasePath, ...lock };
    } catch (error) { rollback(db); throw error; }
  } finally { db.close(); }
}
export function verifyDailyJobPrepLock(databasePathOrOpenDb, token, now = Date.now()) {
  const close = typeof databasePathOrOpenDb === "string";
  const db = close ? open(databasePathOrOpenDb, true) : databasePathOrOpenDb;
  try {
    if (close) db.exec("BEGIN");
    assertCurrentOpportunitySchema(db);
    const lock = read(db);
    if (!lock || lock.token !== token || lock.expiresAt <= now) throw new Error("daily job prep lock is not held by this token");
    if (close) db.exec("COMMIT");
    return { schemaVersion: 1, action: "verified", ...lock };
  } catch (error) { if (close) rollback(db); throw error; } finally { if (close) db.close(); }
}
export function releaseDailyJobPrepLock(databasePath, token) {
  const db = open(databasePath);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      assertCurrentOpportunitySchema(db);
      const lock = read(db);
      if (!lock || lock.token !== token) throw new Error("daily job prep lock is not held by this token");
      db.prepare("DELETE FROM schema_metadata WHERE key = ?").run(LOCK_METADATA_KEY);
      db.exec("COMMIT");
      return { schemaVersion: 1, action: "released", databasePath };
    } catch (error) { rollback(db); throw error; }
  } finally { db.close(); }
}
