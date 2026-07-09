import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {
  APPLICATION_STATUSES,
  APPLICATION_NOTE_TYPES,
  type Application,
  type ApplicationActivity,
  type ApplicationDetail,
  type ApplicationFilters,
  type ApplicationInput,
  type ApplicationNote,
  type ApplicationNoteInput,
  type ApplicationNoteType,
  type ApplicationStatusChange,
  type ApplicationStatus,
  type FollowUpItem
} from "../types";

type SqliteDatabase = ReturnType<typeof Database>;

type ApplicationRow = {
  id: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  source: string | null;
  location: string | null;
  url: string | null;
  contact: string | null;
  notes: string | null;
  applied_date: string | null;
  follow_up_date: string | null;
  created_at: string;
  updated_at: string;
};

type ApplicationNoteRow = {
  id: string;
  application_id: string;
  type: ApplicationNoteType;
  body: string;
  follow_up_date: string | null;
  created_at: string;
};

type FollowUpRow = ApplicationNoteRow & {
  company: string;
  role: string;
  status: ApplicationStatus;
  source: string | null;
  location: string | null;
};

type ApplicationStatusChangeRow = {
  id: string;
  application_id: string;
  from_status: ApplicationStatus | null;
  to_status: ApplicationStatus;
  note: string | null;
  created_at: string;
};

type CachedDatabase = {
  path: string;
  db: SqliteDatabase;
};

const STATUS_SET = new Set<ApplicationStatus>(APPLICATION_STATUSES);
const NOTE_TYPE_SET = new Set<ApplicationNoteType>(APPLICATION_NOTE_TYPES);
const APPLICATION_SELECT_COLUMNS = `
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
`;

let cachedDatabase: CachedDatabase | null = null;
let lastTimestampMs = 0;

function nowIso() {
  const timestampMs = Math.max(Date.now(), lastTimestampMs + 1);
  lastTimestampMs = timestampMs;
  return new Date(timestampMs).toISOString();
}

function getDatabasePath() {
  const configuredPath = process.env.JOBTRACKER_DB_PATH?.trim();
  return configuredPath
    ? path.resolve(configuredPath)
    : path.join(process.cwd(), "data", "jobtracker.sqlite");
}

function ensureSchema(db: SqliteDatabase) {
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
  ensureColumn(db, "application_notes", "type", "TEXT NOT NULL DEFAULT 'update'");
  ensureColumn(db, "application_notes", "follow_up_date", "TEXT");
  backfillLegacyFollowUps(db);
}

function ensureColumn(
  db: SqliteDatabase,
  table: "application_notes",
  column: string,
  definition: string
) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;

  if (!rows.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function backfillLegacyFollowUps(db: SqliteDatabase) {
  const rows = db
    .prepare(
      `
        SELECT id, follow_up_date, updated_at, created_at
        FROM applications
        WHERE follow_up_date IS NOT NULL AND trim(follow_up_date) <> ''
      `
    )
    .all() as Array<{
    id: string;
    follow_up_date: string;
    updated_at: string;
    created_at: string;
  }>;

  if (rows.length === 0) {
    return;
  }

  const findExisting = db.prepare(`
    SELECT id
    FROM application_notes
    WHERE application_id = ?
      AND type = 'follow_up'
      AND follow_up_date = ?
    LIMIT 1
  `);
  const insertFollowUp = db.prepare(`
    INSERT INTO application_notes (
      id,
      application_id,
      type,
      body,
      follow_up_date,
      created_at
    )
    VALUES (?, ?, 'follow_up', 'Follow up', ?, ?)
  `);
  const clearLegacyDate = db.prepare("UPDATE applications SET follow_up_date = NULL WHERE id = ?");

  db.transaction(() => {
    for (const row of rows) {
      if (!findExisting.get(row.id, row.follow_up_date)) {
        insertFollowUp.run(
          randomUUID(),
          row.id,
          row.follow_up_date,
          row.updated_at || row.created_at
        );
      }

      clearLegacyDate.run(row.id);
    }
  })();
}

function getDatabase() {
  const dbPath = getDatabasePath();

  if (cachedDatabase?.path === dbPath && cachedDatabase.db.open) {
    return cachedDatabase.db;
  }

  if (cachedDatabase?.db.open) {
    cachedDatabase.db.close();
  }

  mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);

  cachedDatabase = { path: dbPath, db };
  return db;
}

function mapRow(row: ApplicationRow): Application {
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

function mapNoteRow(row: ApplicationNoteRow): ApplicationNote {
  return {
    id: row.id,
    applicationId: row.application_id,
    type: row.type,
    body: row.body,
    followUpDate: row.follow_up_date,
    createdAt: row.created_at
  };
}

function mapFollowUpRow(row: FollowUpRow): FollowUpItem {
  return {
    ...mapNoteRow(row),
    application: {
      id: row.application_id,
      company: row.company,
      role: row.role,
      status: row.status,
      source: row.source,
      location: row.location
    }
  };
}

function mapStatusChangeRow(row: ApplicationStatusChangeRow): ApplicationStatusChange {
  return {
    id: row.id,
    applicationId: row.application_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    createdAt: row.created_at
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`${label} is required`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${label} is required`);
  }

  return trimmed;
}

function optionalText(value: unknown, label: string) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${label} must be text`);
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalDate(value: unknown, label: string) {
  const text = optionalText(value, label);

  if (text !== null && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${label} must use YYYY-MM-DD format`);
  }

  return text;
}

function readStatus(value: unknown) {
  if (typeof value !== "string" || !STATUS_SET.has(value as ApplicationStatus)) {
    throw new Error("Status is invalid");
  }

  return value as ApplicationStatus;
}

function readNoteType(value: unknown) {
  if (typeof value !== "string" || !NOTE_TYPE_SET.has(value as ApplicationNoteType)) {
    throw new Error("Note type is invalid");
  }

  return value as ApplicationNoteType;
}

function normalizeNoteInput(input: string | ApplicationNoteInput): ApplicationNoteInput {
  if (typeof input === "string") {
    return {
      type: "update",
      body: requiredText(input, "Note"),
      followUpDate: null
    };
  }

  const record: Record<string, unknown> = isRecord(input) ? input : {};
  const type = readNoteType(record.type);
  const body = requiredText(record.body, "Note");

  if (type === "follow_up") {
    const followUpDate = optionalDate(record.followUpDate, "Follow-up date");

    if (!followUpDate) {
      throw new Error("Follow-up date is required");
    }

    return {
      type,
      body,
      followUpDate
    };
  }

  return {
    type,
    body,
    followUpDate: null
  };
}

function normalizeInput(input: ApplicationInput): ApplicationInput {
  const record: Record<string, unknown> = isRecord(input) ? input : {};

  return {
    company: requiredText(record.company, "Company"),
    role: requiredText(record.role, "Role"),
    status: readStatus(record.status),
    source: optionalText(record.source, "Source"),
    location: optionalText(record.location, "Location"),
    url: optionalText(record.url, "URL"),
    contact: optionalText(record.contact, "Contact"),
    notes: optionalText(record.notes, "Notes"),
    appliedDate: optionalDate(record.appliedDate, "Applied date"),
    followUpDate: optionalDate(record.followUpDate, "Follow-up date")
  };
}

export function listApplications(filters: ApplicationFilters = {}): Application[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.status && filters.status !== "all") {
    clauses.push("applications.status = ?");
    params.push(filters.status);
  }

  const search = filters.search?.trim().toLowerCase();

  if (search) {
    clauses.push(`(
      lower(applications.company) LIKE ?
      OR lower(applications.role) LIKE ?
      OR lower(coalesce(applications.source, '')) LIKE ?
      OR lower(coalesce(applications.location, '')) LIKE ?
      OR lower(coalesce(applications.contact, '')) LIKE ?
      OR lower(coalesce(applications.notes, '')) LIKE ?
    )`);

    const query = `%${search}%`;
    params.push(query, query, query, query, query, query);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDatabase()
    .prepare(
      `
        SELECT ${APPLICATION_SELECT_COLUMNS}
        FROM applications
        ${where}
        ORDER BY applications.updated_at DESC, applications.created_at DESC
      `
    )
    .all(...params) as ApplicationRow[];

  return rows.map(mapRow);
}

export function getApplication(id: string): Application | null {
  const row = getDatabase()
    .prepare(
      `
        SELECT ${APPLICATION_SELECT_COLUMNS}
        FROM applications
        WHERE applications.id = ?
      `
    )
    .get(id) as ApplicationRow | undefined;

  return row ? mapRow(row) : null;
}

export function createApplication(input: ApplicationInput): Application {
  const application = normalizeInput(input);
  const now = nowIso();
  const id = randomUUID();
  const db = getDatabase();

  const insertApplication = db.prepare(`
    INSERT INTO applications (
      id,
      company,
      role,
      status,
      source,
      location,
      url,
      contact,
      notes,
      applied_date,
      follow_up_date,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertInitialStatus = db.prepare(`
    INSERT INTO application_status_changes (
      id,
      application_id,
      from_status,
      to_status,
      note,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertFollowUpNote = db.prepare(`
    INSERT INTO application_notes (
      id,
      application_id,
      type,
      body,
      follow_up_date,
      created_at
    )
    VALUES (?, ?, 'follow_up', 'Follow up', ?, ?)
  `);

  db.transaction(() => {
    insertApplication.run(
      id,
      application.company,
      application.role,
      application.status,
      application.source,
      application.location,
      application.url,
      application.contact,
      application.notes,
      application.appliedDate,
      null,
      now,
      now
    );
    insertInitialStatus.run(randomUUID(), id, null, application.status, "Application created", now);

    if (application.followUpDate) {
      insertFollowUpNote.run(randomUUID(), id, application.followUpDate, now);
    }
  })();

  const created = getApplication(id);

  if (!created) {
    throw new Error("Application was not created");
  }

  return created;
}

export function updateApplication(id: string, input: ApplicationInput): Application | null {
  const application = normalizeInput(input);
  const now = nowIso();
  const db = getDatabase();
  const updateApplicationStatement = db.prepare(
    `
        UPDATE applications
        SET
          company = ?,
          role = ?,
          status = ?,
          source = ?,
          location = ?,
          url = ?,
          contact = ?,
          notes = ?,
          applied_date = ?,
          follow_up_date = ?,
          updated_at = ?
        WHERE id = ?
      `
  );
  const insertFollowUpNote = db.prepare(`
    INSERT INTO application_notes (
      id,
      application_id,
      type,
      body,
      follow_up_date,
      created_at
    )
    VALUES (?, ?, 'follow_up', 'Follow up', ?, ?)
  `);

  const result = db.transaction(() => {
    const updateResult = updateApplicationStatement.run(
      application.company,
      application.role,
      application.status,
      application.source,
      application.location,
      application.url,
      application.contact,
      application.notes,
      application.appliedDate,
      null,
      now,
      id
    );

    if (updateResult.changes > 0 && application.followUpDate) {
      insertFollowUpNote.run(randomUUID(), id, application.followUpDate, now);
    }

    return updateResult;
  })();

  if (result.changes === 0) {
    return null;
  }

  return getApplication(id);
}

export function deleteApplication(id: string): boolean {
  const result = getDatabase().prepare("DELETE FROM applications WHERE id = ?").run(id);
  return result.changes > 0;
}

function listApplicationNotes(applicationId: string): ApplicationNote[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT *
        FROM application_notes
        WHERE application_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(applicationId) as ApplicationNoteRow[];

  return rows.map(mapNoteRow);
}

function listApplicationStatusHistory(applicationId: string): ApplicationStatusChange[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT *
        FROM application_status_changes
        WHERE application_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(applicationId) as ApplicationStatusChangeRow[];

  return rows.map(mapStatusChangeRow);
}

function buildActivity(
  notes: ApplicationNote[],
  statusHistory: ApplicationStatusChange[]
): ApplicationActivity[] {
  return [
    ...notes.map((note) => ({
      ...note,
      activityType: "note" as const
    })),
    ...statusHistory.map((statusChange) => ({
      ...statusChange,
      activityType: "status" as const
    }))
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function getApplicationDetail(id: string): ApplicationDetail | null {
  const application = getApplication(id);

  if (!application) {
    return null;
  }

  const notes = listApplicationNotes(id);
  const statusHistory = listApplicationStatusHistory(id);

  return {
    id: application.id,
    company: application.company,
    role: application.role,
    status: application.status,
    source: application.source,
    location: application.location,
    url: application.url,
    contact: application.contact,
    summary: application.notes,
    appliedDate: application.appliedDate,
    followUpDate: application.followUpDate,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    notes,
    statusHistory,
    activity: buildActivity(notes, statusHistory)
  };
}

export function addApplicationNote(
  applicationId: string,
  input: string | ApplicationNoteInput
): ApplicationNote {
  const note = normalizeNoteInput(input);

  if (!getApplication(applicationId)) {
    throw new Error("Application not found");
  }

  const id = randomUUID();
  const now = nowIso();
  const db = getDatabase();
  const insertNote = db.prepare(`
    INSERT INTO application_notes (
      id,
      application_id,
      type,
      body,
      follow_up_date,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const touchApplication = db.prepare("UPDATE applications SET updated_at = ? WHERE id = ?");

  db.transaction(() => {
    insertNote.run(id, applicationId, note.type, note.body, note.followUpDate ?? null, now);
    touchApplication.run(now, applicationId);
  })();

  const row = db.prepare("SELECT * FROM application_notes WHERE id = ?").get(id) as
    | ApplicationNoteRow
    | undefined;

  if (!row) {
    throw new Error("Note was not created");
  }

  return mapNoteRow(row);
}

export function listFollowUps(): FollowUpItem[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT
          n.id,
          n.application_id,
          n.type,
          n.body,
          n.follow_up_date,
          n.created_at,
          a.company,
          a.role,
          a.status,
          a.source,
          a.location
        FROM application_notes n
        INNER JOIN applications a ON a.id = n.application_id
        WHERE n.type = 'follow_up'
          AND n.follow_up_date IS NOT NULL
          AND a.status NOT IN ('archived', 'rejected')
        ORDER BY n.follow_up_date ASC, n.created_at ASC
      `
    )
    .all() as FollowUpRow[];

  return rows.map(mapFollowUpRow);
}

export function changeApplicationStatus(
  applicationId: string,
  status: ApplicationStatus,
  note?: string | null
): ApplicationStatusChange {
  const toStatus = readStatus(status);
  const application = getApplication(applicationId);

  if (!application) {
    throw new Error("Application not found");
  }

  if (application.status === toStatus) {
    throw new Error(`Application is already ${toStatus}`);
  }

  const statusNote = optionalText(note, "Status note");
  const id = randomUUID();
  const now = nowIso();
  const db = getDatabase();
  const updateStatus = db.prepare(
    "UPDATE applications SET status = ?, updated_at = ? WHERE id = ?"
  );
  const insertStatusChange = db.prepare(`
    INSERT INTO application_status_changes (
      id,
      application_id,
      from_status,
      to_status,
      note,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    updateStatus.run(toStatus, now, applicationId);
    insertStatusChange.run(id, applicationId, application.status, toStatus, statusNote, now);
  })();

  const row = db
    .prepare("SELECT * FROM application_status_changes WHERE id = ?")
    .get(id) as ApplicationStatusChangeRow | undefined;

  if (!row) {
    throw new Error("Status change was not recorded");
  }

  return mapStatusChangeRow(row);
}

export function resetStorageForTests() {
  if (cachedDatabase?.db.open) {
    cachedDatabase.db.close();
  }

  cachedDatabase = null;
  lastTimestampMs = 0;
}
