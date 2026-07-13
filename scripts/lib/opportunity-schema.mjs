import { randomUUID } from "node:crypto";

export function ensureOpportunitySchema(db) {
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

function tableExists(db, table) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)); }
function normalized(value) { return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? ""; }

export function migrateLegacyApplications(db) {
  if (!tableExists(db, "applications") || db.prepare("SELECT 1 FROM schema_metadata WHERE key = 'opportunity_schema_version'").get()) return;
  db.transaction(() => {
    const applications = db.prepare("SELECT * FROM applications").all();
    const notes = tableExists(db, "application_notes") ? db.prepare("SELECT * FROM application_notes").all() : [];
    const changes = tableExists(db, "application_status_changes") ? db.prepare("SELECT * FROM application_status_changes").all() : [];
    const artifacts = tableExists(db, "application_artifacts") ? db.prepare("SELECT * FROM application_artifacts").all() : [];
    for (const app of applications) {
      const id = app.id;
      db.prepare("INSERT INTO opportunities VALUES (?, 'job', ?, ?, ?, ?, ?, NULL, ?, ?)").run(id, app.role, app.company, app.status, app.priority || "medium", app.notes, app.created_at, app.updated_at);
      db.prepare("INSERT INTO job_opportunity_details VALUES (?, ?, ?, ?, ?, ?)").run(id, app.url, app.source, app.location, app.contact, app.applied_date);
      db.prepare("INSERT INTO opportunity_activities VALUES (?, ?, 'opportunity_created', 'Opportunity created', NULL, ?, ?)").run(randomUUID(), id, app.created_at, app.created_at);
      db.prepare("INSERT INTO opportunity_activities VALUES (?, ?, 'status_change', ?, ?, ?, ?)").run(randomUUID(), id, `Status set to ${app.status}`, JSON.stringify({ fromStatus: null, toStatus: app.status }), app.created_at, app.created_at);
      const taskPairs = new Set();
      const addTask = (title, dueDate, createdAt) => {
        if (!title?.trim()) return;
        const taskKey = `${normalized(title)}|${dueDate ?? ""}`;
        if (taskPairs.has(taskKey)) return;
        taskPairs.add(taskKey);
        db.prepare("INSERT INTO opportunity_tasks VALUES (?, ?, ?, ?, 'open', NULL, NULL, ?, ?)").run(randomUUID(), id, title.trim(), dueDate, createdAt, createdAt);
      };
      const terminal = app.status === "rejected" || app.status === "archived";
      addTask(app.next_action, app.next_action_date, app.updated_at);
      for (const note of notes.filter((row) => row.application_id === id)) {
        db.prepare("INSERT INTO opportunity_activities VALUES (?, ?, 'note', ?, NULL, ?, ?)").run(note.id || randomUUID(), id, note.body, note.created_at, note.created_at);
        if (!terminal && note.type === "follow_up") addTask(note.body, note.follow_up_date, note.created_at);
      }
      for (const change of changes.filter((row) => row.application_id === id)) db.prepare("INSERT INTO opportunity_activities VALUES (?, ?, 'status_change', ?, ?, ?, ?)").run(change.id || randomUUID(), id, change.note || `Status changed to ${change.to_status}`, JSON.stringify({ fromStatus: change.from_status, toStatus: change.to_status }), change.created_at, change.created_at);
      for (const artifact of artifacts.filter((row) => row.application_id === id)) db.prepare("INSERT INTO opportunity_artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(artifact.id, id, artifact.type, artifact.title, artifact.file_path, artifact.content_type || "text/markdown", artifact.created_at, artifact.updated_at);
    }
    db.prepare("INSERT INTO schema_metadata (key, value) VALUES ('opportunity_schema_version', '1')").run();
  })();
}
