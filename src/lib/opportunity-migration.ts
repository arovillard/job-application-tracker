import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

type SqliteDatabase = ReturnType<typeof Database>;

export function ensureOpportunitySchema(db: SqliteDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS opportunities (id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, organization TEXT, status TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'medium', summary TEXT, origin_opportunity_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (origin_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS job_opportunity_details (opportunity_id TEXT PRIMARY KEY, url TEXT, source TEXT, location TEXT, contact TEXT, applied_date TEXT, FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS connection_opportunity_details (opportunity_id TEXT PRIMARY KEY, role_context TEXT, contact_info TEXT, meeting_context TEXT, relationship_strength TEXT NOT NULL DEFAULT 'new', FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS opportunity_activities (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL, metadata_json TEXT, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS opportunity_tasks (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, title TEXT NOT NULL, due_date TEXT, state TEXT NOT NULL, source_activity_id TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE, FOREIGN KEY (source_activity_id) REFERENCES opportunity_activities(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS opportunity_artifacts (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, file_path TEXT NOT NULL, content_type TEXT NOT NULL DEFAULT 'text/markdown', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(opportunity_id, type, file_path), FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS schema_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS opportunities_status_idx ON opportunities(status);
    CREATE INDEX IF NOT EXISTS opportunities_updated_at_idx ON opportunities(updated_at DESC);
    CREATE INDEX IF NOT EXISTS opportunity_activities_opportunity_occurred_idx ON opportunity_activities(opportunity_id, occurred_at);
    CREATE INDEX IF NOT EXISTS opportunity_tasks_opportunity_state_idx ON opportunity_tasks(opportunity_id, state);
    CREATE INDEX IF NOT EXISTS opportunity_artifacts_opportunity_updated_idx ON opportunity_artifacts(opportunity_id, updated_at DESC);
  `);
}

type LegacyRow = Record<string, string | null>;

function tableExists(db: SqliteDatabase, table: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function normalized(value: string | null) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

export function migrateLegacyApplications(db: SqliteDatabase) {
  if (
    !tableExists(db, "applications") ||
    db.prepare("SELECT 1 FROM schema_metadata WHERE key = 'opportunity_schema_version'").get()
  ) {
    return;
  }

  db.transaction(() => {
    const applications = db.prepare("SELECT * FROM applications").all() as LegacyRow[];
    const notes = tableExists(db, "application_notes")
      ? (db.prepare("SELECT * FROM application_notes").all() as LegacyRow[])
      : [];
    const changes = tableExists(db, "application_status_changes")
      ? (db.prepare("SELECT * FROM application_status_changes").all() as LegacyRow[])
      : [];
    const artifacts = tableExists(db, "application_artifacts")
      ? (db.prepare("SELECT * FROM application_artifacts").all() as LegacyRow[])
      : [];
    const insertOpportunity = db.prepare("INSERT INTO opportunities VALUES (?, 'job', ?, ?, ?, ?, ?, NULL, ?, ?)");
    const insertJob = db.prepare("INSERT INTO job_opportunity_details VALUES (?, ?, ?, ?, ?, ?)");
    const insertActivity = db.prepare("INSERT INTO opportunity_activities VALUES (?, ?, ?, ?, ?, ?, ?)");
    const insertTask = db.prepare("INSERT INTO opportunity_tasks VALUES (?, ?, ?, ?, 'open', NULL, NULL, ?, ?)");
    const insertArtifact = db.prepare("INSERT INTO opportunity_artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const app of applications) {
      const id = app.id!;
      const created = app.created_at!;
      const updated = app.updated_at!;
      insertOpportunity.run(id, app.role, app.company, app.status, app.priority || "medium", app.notes, created, updated);
      insertJob.run(id, app.url, app.source, app.location, app.contact, app.applied_date);
      insertActivity.run(randomUUID(), id, "opportunity_created", "Opportunity created", null, created, created);
      insertActivity.run(randomUUID(), id, "status_change", "Status set to " + app.status, JSON.stringify({ fromStatus: null, toStatus: app.status }), created, created);
      const taskPairs = new Set<string>();
      const addTask = (title: string | null, due: string | null, at: string) => {
        if (!title?.trim()) return;

        const key = `${normalized(title)}|${due ?? ""}`;
        if (taskPairs.has(key)) return;

        taskPairs.add(key);
        insertTask.run(randomUUID(), id, title.trim(), due, at, at);
      };
      const terminal = app.status === "rejected" || app.status === "archived";
      if (!terminal) addTask(app.next_action, app.next_action_date, updated);
      for (const note of notes.filter((row) => row.application_id === id)) {
        insertActivity.run(
          note.id || randomUUID(),
          id,
          "note",
          note.body,
          null,
          note.created_at,
          note.created_at
        );
        if (!terminal && note.type === "follow_up") {
          addTask(note.body, note.follow_up_date, note.created_at!);
        }
      }
      for (const change of changes.filter((row) => row.application_id === id)) {
        insertActivity.run(change.id || randomUUID(), id, "status_change", change.note || `Status changed to ${change.to_status}`, JSON.stringify({ fromStatus: change.from_status, toStatus: change.to_status }), change.created_at, change.created_at);
      }
      for (const artifact of artifacts.filter((row) => row.application_id === id)) {
        insertArtifact.run(artifact.id, id, artifact.type, artifact.title, artifact.file_path, artifact.content_type || "text/markdown", artifact.created_at, artifact.updated_at);
      }
    }
    db.prepare("INSERT INTO schema_metadata (key, value) VALUES ('opportunity_schema_version', '1')").run();
  })();
}
