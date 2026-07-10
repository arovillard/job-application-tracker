#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const APPLICATION_STATUSES = new Set([
  "wishlist",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "archived"
]);
const POSTING_STATES = new Set(["open", "closed", "unknown"]);
const INACTIVE_STATUSES = new Set(["archived", "rejected"]);
const DEFAULT_DB_PATH = process.env.JOBTRACKER_DB_PATH?.trim()
  ? path.resolve(process.env.JOBTRACKER_DB_PATH)
  : path.join(process.cwd(), "data", "jobtracker.sqlite");

function nowIso() {
  return new Date().toISOString();
}

function compactText(value) {
  if (value == null) {
    return null;
  }

  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function requireText(value, label) {
  const text = compactText(value);

  if (!text) {
    throw new Error(`${label} is required`);
  }

  return text;
}

function optionalDate(value, label) {
  const text = compactText(value);

  if (text !== null && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${label} must use YYYY-MM-DD format`);
  }

  return text;
}

function normalizeKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function deriveSource(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().replace(/^www\./, "") || "Public job posting";
  } catch {
    return "Public job posting";
  }
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT,
      location TEXT,
      url TEXT,
      contact TEXT,
      notes TEXT,
      applied_date TEXT,
      follow_up_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS applications_status_idx
      ON applications(status);

    CREATE INDEX IF NOT EXISTS applications_updated_at_idx
      ON applications(updated_at DESC);

    CREATE TABLE IF NOT EXISTS application_notes (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'update',
      body TEXT NOT NULL,
      follow_up_date TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS application_notes_application_created_idx
      ON application_notes(application_id, created_at);

    CREATE TABLE IF NOT EXISTS application_status_changes (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS application_status_changes_application_created_idx
      ON application_status_changes(application_id, created_at);
  `);
}

function connect(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 2000");
  db.pragma("foreign_keys = ON");
  try {
    db.exec("BEGIN IMMEDIATE");
    ensureSchema(db);
    db.exec("COMMIT");
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    db.close();
    throw error;
  }
  return db;
}

function applicationProjectionSql(where) {
  return `
    SELECT
      applications.id,
      applications.company,
      applications.role,
      applications.status,
      applications.source,
      applications.location,
      applications.url,
      applications.contact,
      applications.notes,
      applications.applied_date,
      CASE
        WHEN applications.status IN ('archived', 'rejected') THEN NULL
        ELSE (
          SELECT MIN(application_notes.follow_up_date)
          FROM application_notes
          WHERE application_notes.application_id = applications.id
            AND application_notes.type = 'follow_up'
            AND application_notes.follow_up_date IS NOT NULL
        )
      END AS follow_up_date,
      applications.created_at,
      applications.updated_at
    FROM applications
    ${where}
  `;
}

function rowToApplication(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    company: row.company,
    role: row.role,
    status: row.status,
    source: row.source,
    location: row.location,
    url: row.url,
    contact: row.contact,
    notes: row.notes,
    appliedDate: row.applied_date,
    followUpDate: row.follow_up_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getApplication(db, applicationId) {
  const row = db.prepare(applicationProjectionSql("WHERE applications.id = ?")).get(applicationId);
  const application = rowToApplication(row);

  if (!application) {
    throw new Error("Application was not found after write");
  }

  return application;
}

function findDuplicate(db, company, role) {
  const companyKey = normalizeKey(company);
  const roleKey = normalizeKey(role);
  const rows = db.prepare("SELECT * FROM applications").all();

  return (
    rows.find(
      (row) => normalizeKey(row.company) === companyKey && normalizeKey(row.role) === roleKey
    ) ?? null
  );
}

function insertStatusChange(db, applicationId, fromStatus, toStatus, note, createdAt) {
  db.prepare(
    `
      INSERT INTO application_status_changes (
        id, application_id, from_status, to_status, note, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run(randomUUID(), applicationId, fromStatus, toStatus, note, createdAt);
}

function insertNote(db, applicationId, noteType, body, followUpDate, createdAt) {
  const noteId = randomUUID();
  db.prepare(
    `
      INSERT INTO application_notes (
        id, application_id, type, body, follow_up_date, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run(noteId, applicationId, noteType, body, followUpDate, createdAt);
  return noteId;
}

function buildNote({ action, source, url, postingState, changes, note }) {
  const fragments = [`${action} from public posting`, `source: ${source}`, `url: ${url}`];

  if (postingState !== "unknown") {
    fragments.push(`posting state: ${postingState}`);
  }

  fragments.push(changes.length ? `changes: ${changes.join("; ")}` : "changes: none");

  if (note) {
    fragments.push(`note: ${note}`);
  }

  return `${fragments.join(". ")}.`;
}

function addFollowUpIfRequested(db, applicationId, followUpDate, now) {
  if (followUpDate === null) {
    return null;
  }

  return insertNote(db, applicationId, "follow_up", "Follow up", followUpDate, now);
}

function upsert(payload, dbPath, dryRun) {
  const company = requireText(typeof payload.company === "string" ? payload.company : null, "Company");
  const role = requireText(typeof payload.role === "string" ? payload.role : null, "Role");
  const url = requireText(typeof payload.url === "string" ? payload.url : null, "URL");
  const source =
    compactText(typeof payload.source === "string" ? payload.source : null) ?? deriveSource(url);
  const location = compactText(typeof payload.location === "string" ? payload.location : null);
  const contact = compactText(typeof payload.contact === "string" ? payload.contact : null);
  const summary = compactText(typeof payload.summary === "string" ? payload.summary : null);
  const note = compactText(typeof payload.note === "string" ? payload.note : null);
  const appliedDate = optionalDate(
    typeof payload.applied_date === "string" ? payload.applied_date : null,
    "Applied date"
  );
  const followUpDate = optionalDate(
    typeof payload.follow_up_date === "string" ? payload.follow_up_date : null,
    "Follow-up date"
  );
  const postingState =
    compactText(typeof payload.posting_state === "string" ? payload.posting_state : null) ?? "unknown";
  const requestedStatus = compactText(typeof payload.status === "string" ? payload.status : null);
  const replaceSummary = Boolean(payload.replace_summary);
  const reactivate = Boolean(payload.reactivate);

  if (!POSTING_STATES.has(postingState)) {
    throw new Error(`Posting state must be one of: ${Array.from(POSTING_STATES).sort().join(", ")}`);
  }

  if (requestedStatus !== null && !APPLICATION_STATUSES.has(requestedStatus)) {
    throw new Error(`Status must be one of: ${Array.from(APPLICATION_STATUSES).sort().join(", ")}`);
  }

  const db = connect(dbPath);
  const now = nowIso();

  try {
    db.exec("BEGIN IMMEDIATE");
    const existing = findDuplicate(db, company, role);
    const noteIds = [];
    let followUpNoteId = null;
    let applicationId;
    let action;
    let changes;

    if (existing === null) {
      applicationId = randomUUID();
      const status = requestedStatus ?? "wishlist";
      db.prepare(
        `
          INSERT INTO applications (
            id, company, role, status, source, location, url, contact, notes,
            applied_date, follow_up_date, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `
      ).run(
        applicationId,
        company,
        role,
        status,
        source,
        location,
        url,
        contact,
        summary,
        appliedDate,
        now,
        now
      );
      insertStatusChange(db, applicationId, null, status, "Application created", now);
      changes = ["created new application record"];
      noteIds.push(
        insertNote(
          db,
          applicationId,
          "update",
          buildNote({
            action: "Added tracker record",
            source,
            url,
            postingState,
            changes,
            note
          }),
          null,
          now
        )
      );
      followUpNoteId = addFollowUpIfRequested(db, applicationId, followUpDate, now);
      action = "created";
    } else {
      applicationId = existing.id;
      const assignments = [];
      const values = [];
      changes = [];

      function updateField(column, label, newValue) {
        const oldValue = existing[column];

        if (newValue !== null && newValue !== oldValue) {
          assignments.push(`${column} = ?`);
          values.push(newValue);
          changes.push(`${label}: ${oldValue || "blank"} -> ${newValue}`);
        }
      }

      updateField("source", "source", source);
      updateField("location", "location", location);
      updateField("url", "url", url);
      updateField("contact", "contact", contact);

      if (summary !== null && (replaceSummary || !existing.notes)) {
        updateField("notes", "summary", summary);
      }

      let nextStatus = requestedStatus;

      if (
        nextStatus === null &&
        reactivate &&
        INACTIVE_STATUSES.has(existing.status) &&
        postingState !== "closed"
      ) {
        nextStatus = "wishlist";
      }

      if (nextStatus !== null && nextStatus !== existing.status) {
        assignments.push("status = ?");
        values.push(nextStatus);
        changes.push(`status: ${existing.status} -> ${nextStatus}`);
        insertStatusChange(
          db,
          applicationId,
          existing.status,
          nextStatus,
          "Status updated from public posting review",
          now
        );
      }

      if (assignments.length) {
        assignments.push("updated_at = ?");
        values.push(now, applicationId);
        db.prepare(`UPDATE applications SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
      } else {
        db.prepare("UPDATE applications SET updated_at = ? WHERE id = ?").run(now, applicationId);
      }

      noteIds.push(
        insertNote(
          db,
          applicationId,
          "update",
          buildNote({
            action: "Reviewed existing tracker record",
            source,
            url,
            postingState,
            changes,
            note
          }),
          null,
          now
        )
      );
      followUpNoteId = addFollowUpIfRequested(db, applicationId, followUpDate, now);
      action = "updated";
    }

    const application = getApplication(db, applicationId);

    if (dryRun) {
      db.exec("ROLLBACK");
    } else {
      db.exec("COMMIT");
    }

    db.close();

    return {
      action,
      dryRun,
      dbPath,
      application,
      changes,
      noteIds,
      followUpNoteId
    };
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    db.close();
    throw error;
  }
}

function readJson(inputPath) {
  const raw = inputPath === "-" ? readFileSync(0, "utf8") : readFileSync(inputPath, "utf8");
  const data = JSON.parse(raw);

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Input JSON must be an object");
  }

  return data;
}

function parseArgs(argv) {
  const args = {
    db: DEFAULT_DB_PATH,
    inputJson: null,
    dryRun: false,
    payload: {}
  };
  const fieldMap = new Map([
    ["--company", "company"],
    ["--role", "role"],
    ["--url", "url"],
    ["--source", "source"],
    ["--location", "location"],
    ["--contact", "contact"],
    ["--summary", "summary"],
    ["--note", "note"],
    ["--status", "status"],
    ["--posting-state", "posting_state"],
    ["--applied-date", "applied_date"],
    ["--follow-up-date", "follow_up_date"]
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (fieldMap.has(arg)) {
      index += 1;

      if (index >= argv.length) {
        throw new Error(`${arg} requires a value`);
      }

      args.payload[fieldMap.get(arg)] = argv[index];
    } else if (arg === "--db") {
      index += 1;

      if (index >= argv.length) {
        throw new Error("--db requires a value");
      }

      args.db = path.resolve(argv[index]);
    } else if (arg === "--input-json") {
      index += 1;

      if (index >= argv.length) {
        throw new Error("--input-json requires a value");
      }

      args.inputJson = argv[index];
    } else if (arg === "--replace-summary") {
      args.payload.replace_summary = true;
    } else if (arg === "--reactivate") {
      args.payload.reactivate = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = args.inputJson ? readJson(args.inputJson) : {};

  Object.assign(payload, args.payload);

  const result = upsert(payload, path.resolve(args.db), args.dryRun);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Request failed"}\n`);
  process.exitCode = 1;
}
