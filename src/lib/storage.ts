import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { CONNECTION_STATUSES, JOB_STATUSES, OPPORTUNITY_ACTIVITY_TYPES, OPPORTUNITY_ARTIFACT_TYPES, OPPORTUNITY_PRIORITIES, OPPORTUNITY_TASK_STATES, RELATIONSHIP_STRENGTHS, type ConnectionOpportunity, type JobOpportunity, type JobOpportunityInput, type Opportunity, type OpportunityActivity, type OpportunityActivityInput, type OpportunityArtifact, type OpportunityArtifactInput, type OpportunityDetail, type OpportunityFilters, type OpportunityInput, type OpportunityPriority, type OpportunityStatus, type OpportunitySummary, type OpportunityTask, type OpportunityTaskInput, type OpportunityTaskState, type OpportunityTaskUpdateInput } from "../types";
import { ensureOpportunitySchema, migrateLegacyApplications } from "./opportunity-migration";
import { selectNextOpenTask } from "./opportunity-tasks";

type SqliteDatabase = ReturnType<typeof Database>;
type CachedDatabase = { path: string; db: SqliteDatabase };
type OpportunityRow = {
  id: string; type: "job" | "connection"; label: string; organization: string | null;
  status: OpportunityStatus; priority: OpportunityPriority; summary: string | null;
  origin_opportunity_id: string | null; created_at: string; updated_at: string;
  url: string | null; source: string | null; location: string | null; contact: string | null;
  applied_date: string | null; role_context: string | null; contact_info: string | null;
  meeting_context: string | null; relationship_strength: ConnectionOpportunity["relationshipStrength"] | null;
  last_interaction_at: string | null;
};
type ActivityRow = {
  id: string; opportunity_id: string; type: OpportunityActivity["type"]; body: string;
  metadata_json: string | null; occurred_at: string; created_at: string;
};
type TaskRow = {
  id: string; opportunity_id: string; title: string; due_date: string | null;
  state: OpportunityTaskState; source_activity_id: string | null; completed_at: string | null;
  created_at: string; updated_at: string;
};
type ArtifactRow = {
  id: string; opportunity_id: string; type: OpportunityArtifact["type"]; title: string;
  file_path: string; content_type: string; created_at: string; updated_at: string;
};
let cachedDatabase: CachedDatabase | null = null;
let lastTimestampMs = 0;
const jobStatuses = new Set<string>(JOB_STATUSES), connectionStatuses = new Set<string>(CONNECTION_STATUSES), priorities = new Set<string>(OPPORTUNITY_PRIORITIES), strengths = new Set<string>(RELATIONSHIP_STRENGTHS), activityTypes = new Set<string>(OPPORTUNITY_ACTIVITY_TYPES), taskStates = new Set<string>(OPPORTUNITY_TASK_STATES), artifactTypes = new Set<string>(OPPORTUNITY_ARTIFACT_TYPES);
const humanActivityTypes = new Set(["note", "meeting", "call", "email", "message", "introduction"]);

function nowIso() { const ms = Math.max(Date.now(), lastTimestampMs + 1); lastTimestampMs = ms; return new Date(ms).toISOString(); }
function databasePath() { return process.env.JOBTRACKER_DB_PATH?.trim() ? path.resolve(process.env.JOBTRACKER_DB_PATH) : path.join(process.cwd(), "data", "jobtracker.sqlite"); }
export class DatabaseInitializationError extends Error { constructor(filePath: string, cause: unknown) { super(`Unable to initialize opportunity database at ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`); this.name = "DatabaseInitializationError"; } }
function getDatabase() { const filePath = databasePath(); if (cachedDatabase?.path === filePath && cachedDatabase.db.open) return cachedDatabase.db; if (cachedDatabase?.db.open) cachedDatabase.db.close(); let db: SqliteDatabase | null = null; try { mkdirSync(path.dirname(filePath), { recursive: true }); db = new Database(filePath); db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON"); ensureOpportunitySchema(db); migrateLegacyApplications(db); cachedDatabase = { path: filePath, db }; return db; } catch (error) { db?.close(); throw new DatabaseInitializationError(filePath, error); } }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Input is invalid"); return value as Record<string, unknown>; }
function required(value: unknown, label: string) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`); return value.trim(); }
function optional(value: unknown, label: string) { if (value == null) return null; if (typeof value !== "string") throw new Error(`${label} must be text`); return value.trim() || null; }
function date(value: unknown, label: string) { const result = optional(value, label); if (!result) return null; const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(result); if (!match) throw new Error(`${label} must use YYYY-MM-DD format`); const [, year, month, day] = match; const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))); if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) throw new Error(`${label} must be a real calendar date`); return result; }
function valueFrom<T extends string>(value: unknown, allowed: Set<string>, label: string): T { if (typeof value !== "string" || !allowed.has(value)) throw new Error(`${label} is invalid`); return value as T; }
function metadata(value: unknown) { if (value == null) return null; if (typeof value !== "object" || Array.isArray(value)) throw new Error("Activity metadata must be an object"); return value as Record<string, unknown>; }

function normalizeInput(input: OpportunityInput): OpportunityInput {
  const item = record(input); const type = valueFrom<"job" | "connection">(item.type, new Set(["job", "connection"]), "Type"); const base = { type, label: required(item.label, type === "job" ? "Job label" : "Connection name"), organization: optional(item.organization, "Organization"), status: item.status, priority: item.priority == null ? "medium" : valueFrom<OpportunityPriority>(item.priority, priorities, "Priority"), summary: optional(item.summary, "Summary") };
  if (type === "job") { for (const key of ["roleContext", "contactInfo", "meetingContext", "relationshipStrength"]) if (key in item) throw new Error("Connection fields are not valid for jobs"); return { ...base, type, status: valueFrom(item.status, jobStatuses, "Status"), url: optional(item.url, "URL"), source: optional(item.source, "Source"), location: optional(item.location, "Location"), contact: optional(item.contact, "Contact"), appliedDate: date(item.appliedDate, "Applied date"), originOpportunityId: optional(item.originOpportunityId, "Origin opportunity ID") }; }
  for (const key of ["url", "source", "location", "contact", "appliedDate", "originOpportunityId"]) if (key in item) throw new Error("Job fields are not valid for connections"); return { ...base, type, status: valueFrom(item.status, connectionStatuses, "Status"), roleContext: optional(item.roleContext, "Role context"), contactInfo: optional(item.contactInfo, "Contact info"), meetingContext: optional(item.meetingContext, "Meeting context"), relationshipStrength: item.relationshipStrength == null ? "new" : valueFrom<"new" | "familiar" | "strong">(item.relationshipStrength, strengths, "Relationship strength") };
}
function mapOpportunity(row: OpportunityRow): Opportunity {
  const base = { id: row.id, type: row.type, label: row.label, organization: row.organization, status: row.status, priority: row.priority, summary: row.summary, originOpportunityId: row.origin_opportunity_id, createdAt: row.created_at, updatedAt: row.updated_at };
  return row.type === "job" ? { ...base, type: "job", url: row.url, source: row.source, location: row.location, contact: row.contact, appliedDate: row.applied_date } as JobOpportunity : { ...base, type: "connection", originOpportunityId: null, roleContext: row.role_context, contactInfo: row.contact_info, meetingContext: row.meeting_context, relationshipStrength: row.relationship_strength, lastInteractionAt: row.last_interaction_at } as ConnectionOpportunity;
}
const projection = `SELECT o.*, j.url, j.source, j.location, j.contact, j.applied_date, c.role_context, c.contact_info, c.meeting_context, c.relationship_strength, (SELECT MAX(occurred_at) FROM opportunity_activities a WHERE a.opportunity_id = o.id AND a.type IN ('meeting','call','email','message','introduction')) AS last_interaction_at FROM opportunities o LEFT JOIN job_opportunity_details j ON j.opportunity_id = o.id LEFT JOIN connection_opportunity_details c ON c.opportunity_id = o.id`;
function opportunity(id: string) { const row = getDatabase().prepare(`${projection} WHERE o.id = ?`).get(id) as OpportunityRow | undefined; return row ? mapOpportunity(row) : null; }
function mapActivity(row: ActivityRow): OpportunityActivity { return { id: row.id, opportunityId: row.opportunity_id, type: row.type, body: row.body, metadata: row.metadata_json ? JSON.parse(row.metadata_json) as Record<string, unknown> : null, occurredAt: row.occurred_at, createdAt: row.created_at }; }
function mapTask(row: TaskRow): OpportunityTask { return { id: row.id, opportunityId: row.opportunity_id, title: row.title, dueDate: row.due_date, state: row.state, sourceActivityId: row.source_activity_id, completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at }; }
function mapArtifact(row: ArtifactRow): OpportunityArtifact { return { id: row.id, opportunityId: row.opportunity_id, type: row.type, title: row.title, filePath: row.file_path, contentType: row.content_type, createdAt: row.created_at, updatedAt: row.updated_at }; }
function writeActivity(db: SqliteDatabase, opportunityId: string, type: string, body: string, at: string, data: Record<string, unknown> | null = null) { const id = randomUUID(); db.prepare("INSERT INTO opportunity_activities VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, opportunityId, type, body, data ? JSON.stringify(data) : null, at, at); return id; }
function normalizedTask(input: OpportunityTaskInput) { const item = record(input); return { title: required(item.title, "Task title"), dueDate: date(item.dueDate, "Task due date"), sourceActivityId: optional(item.sourceActivityId, "Source activity ID") }; }
function ensureExists(id: string) { const item = opportunity(id); if (!item) throw new Error("Opportunity not found"); return item; }

function validateJobOrigin(originOpportunityId: string | null | undefined) {
  if (!originOpportunityId) return;

  const origin = opportunity(originOpportunityId);
  if (!origin) throw new Error("Origin opportunity not found");
  if (origin.type !== "connection" || origin.status === "archived") {
    throw new Error("Origin must be an active connection");
  }
}

function assertConnectionCanArchive(db: SqliteDatabase, id: string) {
  const linkedJob = db
    .prepare("SELECT id FROM opportunities WHERE origin_opportunity_id = ? LIMIT 1")
    .get(id);

  if (linkedJob) {
    throw new Error("Cannot archive a connection with originating jobs");
  }
}

function insertOpportunity(db: SqliteDatabase, id: string, item: OpportunityInput, now: string) {
  db.prepare(
    "INSERT INTO opportunities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    item.type,
    item.label,
    item.organization,
    item.status,
    item.priority,
    item.summary,
    item.type === "job" ? item.originOpportunityId : null,
    now,
    now
  );

  if (item.type === "job") {
    db.prepare("INSERT INTO job_opportunity_details VALUES (?, ?, ?, ?, ?, ?)").run(
      id,
      item.url,
      item.source,
      item.location,
      item.contact,
      item.appliedDate
    );
  } else {
    db.prepare("INSERT INTO connection_opportunity_details VALUES (?, ?, ?, ?, ?)").run(
      id,
      item.roleContext,
      item.contactInfo,
      item.meetingContext,
      item.relationshipStrength
    );
  }

  writeActivity(
    db,
    id,
    "opportunity_created",
    "Opportunity created",
    now,
    item.type === "job" && item.originOpportunityId
      ? { originOpportunityId: item.originOpportunityId }
      : null
  );
}

export function listOpportunities(filters: OpportunityFilters = {}): OpportunitySummary[] { const clauses: string[] = [], args: unknown[] = []; if (filters.type && filters.type !== "all") { clauses.push("o.type = ?"); args.push(filters.type); } if (filters.status && filters.status !== "all") { clauses.push("o.status = ?"); args.push(filters.status); } if (!filters.includeArchived) clauses.push("o.status <> 'archived'"); if (filters.search?.trim()) { const q = `%${filters.search.trim().toLowerCase()}%`; clauses.push("(lower(o.label) LIKE ? OR lower(coalesce(o.organization,'')) LIKE ? OR lower(coalesce(o.summary,'')) LIKE ? OR lower(coalesce(j.url,'')) LIKE ? OR lower(coalesce(j.source,'')) LIKE ? OR lower(coalesce(c.role_context,'')) LIKE ? OR lower(coalesce(c.contact_info,'')) LIKE ? OR lower(coalesce(c.meeting_context,'')) LIKE ?)"); args.push(q,q,q,q,q,q,q,q); } const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""; const db = getDatabase(); return (db.prepare(`${projection}${where} ORDER BY o.updated_at DESC, o.created_at DESC`).all(...args) as OpportunityRow[]).map((row) => ({ ...mapOpportunity(row), nextOpenTask: selectNextOpenTask((db.prepare("SELECT * FROM opportunity_tasks WHERE opportunity_id = ? AND state = 'open' ORDER BY due_date IS NULL, due_date, created_at").all(row.id) as TaskRow[]).map(mapTask)) })); }
export function getOpportunityDetail(id: string): OpportunityDetail | null { const item = opportunity(id); if (!item) return null; const db = getDatabase(); const activities = (db.prepare("SELECT * FROM opportunity_activities WHERE opportunity_id = ? ORDER BY occurred_at, created_at, rowid").all(id) as ActivityRow[]).map(mapActivity); const tasks = (db.prepare("SELECT * FROM opportunity_tasks WHERE opportunity_id = ? ORDER BY created_at").all(id) as TaskRow[]).map(mapTask); const artifacts = (db.prepare("SELECT * FROM opportunity_artifacts WHERE opportunity_id = ? ORDER BY updated_at DESC, created_at DESC").all(id) as ArtifactRow[]).map(mapArtifact); const origin = item.originOpportunityId ? opportunity(item.originOpportunityId) : null; const originatedJobs = item.type === "connection" ? (db.prepare(`${projection} WHERE o.origin_opportunity_id = ? ORDER BY o.created_at`).all(id) as OpportunityRow[]).map(mapOpportunity).filter((candidate): candidate is JobOpportunity => candidate.type === "job") : []; return { ...item, activities, tasks, artifacts, origin: origin?.type === "connection" ? origin : null, originatedJobs }; }
export function createOpportunity(
  input: OpportunityInput,
  initial: { activity?: OpportunityActivityInput | null; task?: OpportunityTaskInput | null } = {}
): OpportunityDetail {
  const item = normalizeInput(input);
  const db = getDatabase();
  const id = randomUUID();
  const now = nowIso();

  if (item.type === "job") validateJobOrigin(item.originOpportunityId);

  db.transaction(() => {
    insertOpportunity(db, id, item, now);
    if (initial.activity) {
      const activity = normalizeActivity(initial.activity);
      const activityId = writeActivity(
        db,
        id,
        activity.type,
        activity.body,
        activity.occurredAt ?? now,
        activity.metadata
      );
      if (initial.task) {
        insertTask(db, id, normalizedTask({ ...initial.task, sourceActivityId: activityId }), now);
      }
    } else if (initial.task) {
      insertTask(db, id, normalizedTask(initial.task), now);
    }
  })();

  return getOpportunityDetail(id)!;
}

function normalizeActivity(input: OpportunityActivityInput) {
  const item = record(input);
  const type = valueFrom<string>(item.type, activityTypes, "Activity type");
  if (!humanActivityTypes.has(type)) throw new Error("Activity type must be user-created");

  const occurredAt = optional(item.occurredAt, "Activity occurrence time");
  const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (occurredAt && (!isoTimestamp.test(occurredAt) || Number.isNaN(Date.parse(occurredAt)))) {
    throw new Error("Activity occurrence time must be an ISO timestamp");
  }

  return { type, body: required(item.body, "Activity body"), occurredAt, metadata: metadata(item.metadata) };
}
function insertTask(db: SqliteDatabase, opportunityId: string, task: ReturnType<typeof normalizedTask>, now: string) { if (task.sourceActivityId && !db.prepare("SELECT 1 FROM opportunity_activities WHERE id=? AND opportunity_id=?").get(task.sourceActivityId, opportunityId)) throw new Error("Source activity does not belong to this opportunity"); const id = randomUUID(); db.prepare("INSERT INTO opportunity_tasks VALUES (?, ?, ?, ?, 'open', ?, NULL, ?, ?)").run(id,opportunityId,task.title,task.dueDate,task.sourceActivityId,now,now); writeActivity(db,opportunityId,"task_created",`Task created: ${task.title}`,now,{ taskId:id, dueDate:task.dueDate }); return id; }
export function updateOpportunity(id: string, input: OpportunityInput): OpportunityDetail | null {
  const existing = opportunity(id);
  if (!existing) return null;

  const item = normalizeInput(input);
  if (existing.type !== item.type) throw new Error("Opportunity type cannot change");
  if (item.type === "job") validateJobOrigin(item.originOpportunityId);

  const now = nowIso();
  const db = getDatabase();
  if (existing.type === "connection" && item.status === "archived") {
    assertConnectionCanArchive(db, id);
  }
  db.transaction(() => {
    db.prepare(
      "UPDATE opportunities SET label=?, organization=?, status=?, priority=?, summary=?, origin_opportunity_id=?, updated_at=? WHERE id=?"
    ).run(
      item.label,
      item.organization,
      item.status,
      item.priority,
      item.summary,
      item.type === "job" ? item.originOpportunityId : null,
      now,
      id
    );
    if (item.type === "job") {
      db.prepare(
        "UPDATE job_opportunity_details SET url=?,source=?,location=?,contact=?,applied_date=? WHERE opportunity_id=?"
      ).run(item.url, item.source, item.location, item.contact, item.appliedDate, id);
    } else {
      db.prepare(
        "UPDATE connection_opportunity_details SET role_context=?,contact_info=?,meeting_context=?,relationship_strength=? WHERE opportunity_id=?"
      ).run(item.roleContext, item.contactInfo, item.meetingContext, item.relationshipStrength, id);
    }
    if (existing.status !== item.status) {
      writeActivity(db, id, "status_change", `Status changed to ${item.status}`, now, {
        fromStatus: existing.status,
        toStatus: item.status
      });
    }
  })();

  return getOpportunityDetail(id);
}
export function deleteOpportunity(id: string) { return getDatabase().prepare("DELETE FROM opportunities WHERE id = ?").run(id).changes > 0; }
export function changeOpportunityStatus(
  id: string,
  status: OpportunityStatus,
  note?: string | null
): OpportunityDetail {
  const item = ensureExists(id);
  const allowed = item.type === "job" ? jobStatuses : connectionStatuses;
  const next = valueFrom<string>(status, allowed, "Status");
  if (item.status === next) throw new Error(`Opportunity is already ${next}`);

  const db = getDatabase();
  if (item.type === "connection" && next === "archived") {
    assertConnectionCanArchive(db, id);
  }

  const now = nowIso();
  const body = optional(note, "Status note") ?? `Status changed to ${next}`;
  db.transaction(() => {
    db.prepare("UPDATE opportunities SET status=?,updated_at=? WHERE id=?").run(next, now, id);
    writeActivity(db, id, "status_change", body, now, { fromStatus: item.status, toStatus: next });
  })();
  return getOpportunityDetail(id)!;
}
export function addOpportunityActivity(id: string, input: OpportunityActivityInput, task?: OpportunityTaskInput | null): OpportunityDetail { ensureExists(id); const activity=normalizeActivity(input),now=nowIso(),db=getDatabase(); db.transaction(() => { const activityId=writeActivity(db,id,activity.type,activity.body,activity.occurredAt ?? now,activity.metadata); if(task) insertTask(db,id,normalizedTask({...task,sourceActivityId:activityId}),now); db.prepare("UPDATE opportunities SET updated_at=? WHERE id=?").run(now,id); })(); return getOpportunityDetail(id)!; }
export function createOpportunityTask(id: string, input: OpportunityTaskInput): OpportunityDetail { ensureExists(id); const now=nowIso(),db=getDatabase(); db.transaction(() => { insertTask(db,id,normalizedTask(input),now); db.prepare("UPDATE opportunities SET updated_at=? WHERE id=?").run(now,id); })(); return getOpportunityDetail(id)!; }
export function updateOpportunityTask(
  id: string,
  taskId: string,
  input: OpportunityTaskUpdateInput
): OpportunityDetail {
  ensureExists(id);

  const db = getDatabase();
  const taskRow = db
    .prepare("SELECT * FROM opportunity_tasks WHERE id=? AND opportunity_id=?")
    .get(taskId, id) as {
    id: string;
    opportunity_id: string;
    title: string;
    due_date: string | null;
    state: OpportunityTaskState;
    source_activity_id: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
  } | undefined;
  if (!taskRow) throw new Error("Task not found");

  const task = mapTask(taskRow);
  const item = record(input);
  const nextState =
    item.state == null
      ? task.state
      : valueFrom<OpportunityTaskState>(item.state, taskStates, "Task state");
  const nextTitle = item.title == null ? task.title : required(item.title, "Task title");
  const nextDue = item.dueDate === undefined ? task.dueDate : date(item.dueDate, "Task due date");
  const reopening = task.state !== "open" && nextState === "open";
  if (task.state !== "open" && item.state != null && nextState === task.state) throw new Error("Task is already terminal");
  if (task.state !== "open" && nextState !== task.state && !reopening) {
    throw new Error("Terminal task cannot change state");
  }

  const terminalTransition = task.state === "open" && nextState !== "open";
  const event = terminalTransition
    ? nextState === "completed"
      ? "task_completed"
      : "task_cancelled"
    : nextDue !== task.dueDate
      ? "task_rescheduled"
      : null;
  const now = nowIso();
  const completedAt = reopening
    ? null
    : terminalTransition && nextState === "completed"
      ? now
      : task.completedAt;

  db.transaction(() => {
    db.prepare(
      "UPDATE opportunity_tasks SET title=?,due_date=?,state=?,completed_at=?,updated_at=? WHERE id=?"
    ).run(nextTitle, nextDue, nextState, completedAt, now, taskId);
    if (event) {
      writeActivity(db, id, event, `Task ${event.replace("task_", "")}: ${nextTitle}`, now, {
        taskId,
        fromDueDate: task.dueDate,
        toDueDate: nextDue
      });
    }
    db.prepare("UPDATE opportunities SET updated_at=? WHERE id=?").run(now, id);
  })();

  return getOpportunityDetail(id)!;
}
export function createLinkedJobOpportunity(
  connectionId: string,
  input: JobOpportunityInput
): OpportunityDetail {
  const connection = ensureExists(connectionId);
  if (connection.type !== "connection" || connection.status === "archived") {
    throw new Error("Linked job requires an active connection");
  }

  const job = normalizeInput({ ...input, type: "job", originOpportunityId: connectionId });
  if (job.type !== "job") throw new Error("Linked opportunity must be a job");

  const db = getDatabase();
  const jobId = randomUUID();
  const now = nowIso();
  db.transaction(() => {
    insertOpportunity(db, jobId, job, now);
    writeActivity(db, connectionId, "linked_job_created", `Linked job created: ${job.label}`, now, {
      jobOpportunityId: jobId
    });
    db.prepare("UPDATE opportunities SET updated_at=? WHERE id=?").run(now, connectionId);
  })();

  return getOpportunityDetail(jobId)!;
}
export function upsertOpportunityArtifact(id: string, input: OpportunityArtifactInput): OpportunityArtifact { const item=ensureExists(id); if(item.type !== "job") throw new Error("Artifacts are only valid for job opportunities"); const raw=record(input), type=valueFrom<string>(raw.type,artifactTypes,"Artifact type"), title=required(raw.title,"Artifact title"), filePath=path.resolve(required(raw.filePath,"Artifact file path")), contentType=optional(raw.contentType,"Content type") ?? "text/markdown",now=nowIso(),db=getDatabase(); db.transaction(() => { db.prepare("INSERT INTO opportunity_artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(opportunity_id,type,file_path) DO UPDATE SET title=excluded.title,content_type=excluded.content_type,updated_at=excluded.updated_at").run(randomUUID(),id,type,title,filePath,contentType,now,now); db.prepare("UPDATE opportunities SET updated_at=? WHERE id=?").run(now,id); })(); return mapArtifact(db.prepare("SELECT * FROM opportunity_artifacts WHERE opportunity_id=? AND type=? AND file_path=?").get(id,type,filePath) as ArtifactRow); }
export function resetStorageForTests() { if (cachedDatabase?.db.open) cachedDatabase.db.close(); cachedDatabase=null; lastTimestampMs=0; }
