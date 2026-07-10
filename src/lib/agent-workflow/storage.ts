import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {
  AGENT_RUN_STATES,
  type AgentArtifactLink,
  type AgentEventMetadataValue,
  type AgentPreview,
  type AgentProviderName,
  type AgentRun,
  type AgentRunEvent,
  type AgentRunEventKind,
  type AgentRunState,
  type AgentUsage,
  type ArtifactManifestEntry,
  type PublicAgentRun
} from "./types";

type SqliteDatabase = ReturnType<typeof Database>;

type AgentRunRow = {
  id: string;
  provider: string;
  model: string;
  canonical_job_url: string;
  state: string;
  preview_json: string | null;
  application_id: string | null;
  artifact_manifest_json: string | null;
  artifact_links_json: string | null;
  usage_json: string | null;
  cancellation_requested: number;
  worker_id: string | null;
  lease_expires_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
};

type AgentRunEventRow = {
  id: string;
  run_id: string;
  sequence: number;
  kind: string;
  message: string;
  metadata_json: string | null;
  created_at: string;
};

type CachedDatabase = {
  path: string;
  db: SqliteDatabase;
};

export type CreateAgentRunInput = {
  provider: AgentProviderName;
  model: string;
  canonicalJobUrl: string;
};

export type AppendAgentRunEventInput = {
  kind: AgentRunEventKind;
  message: string;
  metadata?: Record<string, AgentEventMetadataValue> | null;
};

export type AgentRunTransitionPatch = {
  preview?: AgentPreview | null;
  applicationId?: string | null;
  artifactManifest?: ArtifactManifestEntry[] | null;
  artifactLinks?: AgentArtifactLink[];
  usage?: AgentUsage | null;
  failureCode?: string | null;
  failureMessage?: string | null;
};

const PROVIDERS = new Set<AgentProviderName>(["codex", "claude"]);
const RUN_STATES = new Set<string>(AGENT_RUN_STATES);
const EVENT_KINDS = new Set<AgentRunEventKind>([
  "status",
  "progress",
  "warning",
  "usage",
  "error"
]);
const ARTIFACT_TYPES = new Set<ArtifactManifestEntry["type"]>([
  "fit_analysis",
  "outreach_message",
  "referral_message",
  "cover_letter",
  "resume",
  "posting",
  "other"
]);
const ACTIVE_STATES = new Set<AgentRunState>(["previewing", "executing", "verifying"]);
const LEGAL_TRANSITIONS: Readonly<Record<AgentRunState, ReadonlySet<AgentRunState>>> = {
  queued_preview: new Set(["previewing", "cancelled"]),
  previewing: new Set(["awaiting_approval", "failed", "cancelled", "interrupted"]),
  awaiting_approval: new Set(["queued_execution", "cancelled"]),
  queued_execution: new Set(["cancelled"]),
  executing: new Set(["verifying", "failed", "cancelled", "interrupted"]),
  verifying: new Set(["succeeded", "failed", "cancelled", "interrupted"]),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  interrupted: new Set()
};
const EXECUTION_LEASE_NAME = "mutating_execution";

let cachedDatabase: CachedDatabase | null = null;
let lastTimestampMs = 0;

function nowIso() {
  const timestampMs = Math.max(Date.now(), lastTimestampMs + 1);
  lastTimestampMs = timestampMs;
  return new Date(timestampMs).toISOString();
}

function leaseExpiryIso(leaseDurationMs: number) {
  if (!Number.isFinite(leaseDurationMs)) {
    throw new Error("Lease duration must be finite");
  }
  return new Date(Date.now() + leaseDurationMs).toISOString();
}

function getDatabasePath() {
  const configuredPath = process.env.JOBTRACKER_DB_PATH?.trim();
  return configuredPath
    ? path.resolve(configuredPath)
    : path.join(process.cwd(), "data", "jobtracker.sqlite");
}

function ensureSchema(db: SqliteDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      canonical_job_url TEXT NOT NULL,
      state TEXT NOT NULL,
      preview_json TEXT,
      application_id TEXT,
      artifact_manifest_json TEXT,
      artifact_links_json TEXT,
      usage_json TEXT,
      cancellation_requested INTEGER NOT NULL DEFAULT 0,
      worker_id TEXT,
      lease_expires_at TEXT,
      failure_code TEXT,
      failure_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS agent_runs_state_created_idx
      ON agent_runs(state, created_at, id);

    CREATE TABLE IF NOT EXISTS agent_run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(run_id, sequence),
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS agent_run_events_run_sequence_idx
      ON agent_run_events(run_id, sequence);

    CREATE TABLE IF NOT EXISTS agent_worker_leases (
      name TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );
  `);
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: string[]) {
  const actualKeys = Object.keys(value).sort();
  return actualKeys.length === keys.length && actualKeys.every((key, index) => key === [...keys].sort()[index]);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isAgentPreview(value: unknown): value is AgentPreview {
  if (!isPlainObject(value) || !hasExactlyKeys(value, ["company", "role", "location", "summary", "postingState"])) {
    return false;
  }
  return (
    isString(value.company) &&
    isString(value.role) &&
    isNullableString(value.location) &&
    isString(value.summary) &&
    (value.postingState === "open" || value.postingState === "closed" || value.postingState === "unknown")
  );
}

function isArtifactManifestEntry(value: unknown): value is ArtifactManifestEntry {
  if (!isPlainObject(value) || !hasExactlyKeys(value, ["type", "title", "filePath", "contentType"])) {
    return false;
  }
  return (
    isString(value.type) &&
    ARTIFACT_TYPES.has(value.type as ArtifactManifestEntry["type"]) &&
    isString(value.title) &&
    isString(value.filePath) &&
    isString(value.contentType)
  );
}

function isArtifactLink(value: unknown): value is AgentArtifactLink {
  if (!isPlainObject(value) || !hasExactlyKeys(value, ["id", "type", "title", "href"])) {
    return false;
  }
  return (
    isString(value.id) &&
    isString(value.type) &&
    ARTIFACT_TYPES.has(value.type as ArtifactManifestEntry["type"]) &&
    isString(value.title) &&
    isString(value.href)
  );
}

function isUsage(value: unknown): value is AgentUsage {
  return (
    isPlainObject(value) &&
    Object.values(value).every(
      (entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0
    )
  );
}

function isMetadata(value: unknown): value is Record<string, AgentEventMetadataValue> {
  return (
    isPlainObject(value) &&
    Object.values(value).every(
      (entry) =>
        entry === null ||
        typeof entry === "string" ||
        typeof entry === "boolean" ||
        (typeof entry === "number" && Number.isFinite(entry))
    )
  );
}

function parseJson<T>(value: string | null, validator: (candidate: unknown) => candidate is T): T | null {
  if (value === null) {
    return null;
  }
  const parsed: unknown = JSON.parse(value);
  if (!validator(parsed)) {
    throw new Error("Stored agent run JSON is invalid");
  }
  return parsed;
}

function parseJsonArray<T>(
  value: string | null,
  validator: (candidate: unknown) => candidate is T
): T[] | null {
  return parseJson(value, (candidate): candidate is T[] => Array.isArray(candidate) && candidate.every(validator));
}

function requireNonEmpty(value: string, name: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} is required`);
  }
  return trimmed;
}

function requireWorkerId(workerId: string) {
  return requireNonEmpty(workerId, "Worker id");
}

function serializeValidated<T>(
  value: T | null,
  validator: (candidate: unknown) => candidate is T,
  name: string
) {
  if (value === null) {
    return null;
  }
  if (!validator(value)) {
    throw new Error(`${name} is invalid`);
  }
  return JSON.stringify(value);
}

function mapRunRow(row: AgentRunRow): AgentRun {
  if (!PROVIDERS.has(row.provider as AgentProviderName) || !RUN_STATES.has(row.state)) {
    throw new Error("Stored agent run has an invalid provider or state");
  }
  return {
    id: row.id,
    provider: row.provider as AgentProviderName,
    model: row.model,
    canonicalJobUrl: row.canonical_job_url,
    state: row.state as AgentRunState,
    preview: parseJson(row.preview_json, isAgentPreview),
    applicationId: row.application_id,
    artifactManifest: parseJsonArray(row.artifact_manifest_json, isArtifactManifestEntry),
    artifactLinks: parseJsonArray(row.artifact_links_json, isArtifactLink) ?? [],
    usage: parseJson(row.usage_json, isUsage),
    cancellationRequested: row.cancellation_requested === 1,
    workerId: row.worker_id,
    leaseExpiresAt: row.lease_expires_at,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEventRow(row: AgentRunEventRow): AgentRunEvent {
  if (!EVENT_KINDS.has(row.kind as AgentRunEventKind)) {
    throw new Error("Stored agent run event kind is invalid");
  }
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    kind: row.kind as AgentRunEventKind,
    message: row.message,
    metadata: parseJson(row.metadata_json, isMetadata),
    createdAt: row.created_at
  };
}

function listAgentRunEvents(runId: string) {
  const rows = getDatabase()
    .prepare("SELECT * FROM agent_run_events WHERE run_id = ? ORDER BY sequence")
    .all(runId) as AgentRunEventRow[];
  return rows.map(mapEventRow);
}

export function createAgentRun(input: CreateAgentRunInput): AgentRun {
  if (!PROVIDERS.has(input.provider)) {
    throw new Error("Agent provider is invalid");
  }
  const timestamp = nowIso();
  const id = randomUUID();
  getDatabase()
    .prepare(`
      INSERT INTO agent_runs (
        id, provider, model, canonical_job_url, state, cancellation_requested,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'queued_preview', 0, ?, ?)
    `)
    .run(
      id,
      input.provider,
      requireNonEmpty(input.model, "Model"),
      requireNonEmpty(input.canonicalJobUrl, "Canonical job URL"),
      timestamp,
      timestamp
    );
  return getAgentRun(id) as AgentRun;
}

export function getAgentRun(id: string): AgentRun | null {
  const row = getDatabase().prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as
    | AgentRunRow
    | undefined;
  return row ? mapRunRow(row) : null;
}

export function getPublicAgentRun(id: string): PublicAgentRun | null {
  const run = getAgentRun(id);
  if (!run) {
    return null;
  }
  return {
    id: run.id,
    provider: run.provider,
    model: run.model,
    canonicalJobUrl: run.canonicalJobUrl,
    state: run.state,
    preview: run.preview,
    applicationId: run.applicationId,
    artifactLinks: run.artifactLinks,
    usage: run.usage,
    cancellationRequested: run.cancellationRequested,
    failureCode: run.failureCode,
    failureMessage: run.failureMessage,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    events: listAgentRunEvents(id)
  };
}

export function appendAgentRunEvent(
  runId: string,
  input: AppendAgentRunEventInput
): AgentRunEvent {
  if (!EVENT_KINDS.has(input.kind)) {
    throw new Error("Agent event kind is invalid");
  }
  const message = requireNonEmpty(input.message, "Event message");
  const metadata = input.metadata ?? null;
  const metadataJson = serializeValidated(metadata, isMetadata, "Event metadata");
  const db = getDatabase();

  const event = db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM agent_runs WHERE id = ?").get(runId)) {
      throw new Error("Agent run not found");
    }
    const sequenceRow = db
      .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM agent_run_events WHERE run_id = ?")
      .get(runId) as { sequence: number };
    const row: AgentRunEventRow = {
      id: randomUUID(),
      run_id: runId,
      sequence: sequenceRow.sequence,
      kind: input.kind,
      message,
      metadata_json: metadataJson,
      created_at: nowIso()
    };
    db.prepare(`
      INSERT INTO agent_run_events (id, run_id, sequence, kind, message, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.run_id, row.sequence, row.kind, row.message, row.metadata_json, row.created_at);
    return mapEventRow(row);
  }).immediate();

  return event;
}

function transitionColumns(patch: AgentRunTransitionPatch) {
  const columns: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    columns.push(`${column} = ?`);
    values.push(value);
  };

  if ("preview" in patch) {
    add("preview_json", serializeValidated(patch.preview ?? null, isAgentPreview, "Preview"));
  }
  if ("applicationId" in patch) {
    add("application_id", patch.applicationId === null ? null : requireNonEmpty(patch.applicationId ?? "", "Application id"));
  }
  if ("artifactManifest" in patch) {
    add(
      "artifact_manifest_json",
      serializeValidated(
        patch.artifactManifest ?? null,
        (value): value is ArtifactManifestEntry[] => Array.isArray(value) && value.every(isArtifactManifestEntry),
        "Artifact manifest"
      )
    );
  }
  if ("artifactLinks" in patch) {
    add(
      "artifact_links_json",
      serializeValidated(
        patch.artifactLinks ?? [],
        (value): value is AgentArtifactLink[] => Array.isArray(value) && value.every(isArtifactLink),
        "Artifact links"
      )
    );
  }
  if ("usage" in patch) {
    add("usage_json", serializeValidated(patch.usage ?? null, isUsage, "Usage"));
  }
  if ("failureCode" in patch) {
    add("failure_code", patch.failureCode === null ? null : requireNonEmpty(patch.failureCode ?? "", "Failure code"));
  }
  if ("failureMessage" in patch) {
    add(
      "failure_message",
      patch.failureMessage === null ? null : requireNonEmpty(patch.failureMessage ?? "", "Failure message")
    );
  }
  return { columns, values };
}

export function transitionAgentRun(
  id: string,
  expectedState: AgentRunState,
  nextState: AgentRunState,
  patch: AgentRunTransitionPatch = {}
): AgentRun | null {
  if (!LEGAL_TRANSITIONS[expectedState].has(nextState)) {
    return null;
  }
  const db = getDatabase();
  const result = db.transaction(() => {
    const { columns, values } = transitionColumns(patch);
    columns.unshift("state = ?");
    values.unshift(nextState);
    if (!ACTIVE_STATES.has(nextState)) {
      columns.push("worker_id = NULL", "lease_expires_at = NULL");
    }
    columns.push("updated_at = ?");
    values.push(nowIso());
    const update = db
      .prepare(`UPDATE agent_runs SET ${columns.join(", ")} WHERE id = ? AND state = ?`)
      .run(...values, id, expectedState);
    if (update.changes !== 1) {
      return null;
    }
    if ((expectedState === "executing" || expectedState === "verifying") && !ACTIVE_STATES.has(nextState)) {
      db.prepare("DELETE FROM agent_worker_leases WHERE name = ? AND run_id = ?").run(
        EXECUTION_LEASE_NAME,
        id
      );
    }
    return getAgentRun(id);
  }).immediate();
  return result;
}

export function approveAgentRun(id: string): AgentRun | null {
  return transitionAgentRun(id, "awaiting_approval", "queued_execution");
}

export function requestAgentRunCancellation(id: string): AgentRun | null {
  const db = getDatabase();
  return db.transaction(() => {
    const timestamp = nowIso();
    const immediate = db
      .prepare(`
        UPDATE agent_runs
        SET state = 'cancelled', cancellation_requested = 1,
            worker_id = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE id = ? AND state IN ('queued_preview', 'awaiting_approval', 'queued_execution')
      `)
      .run(timestamp, id);
    if (immediate.changes === 1) {
      db.prepare("DELETE FROM agent_worker_leases WHERE name = ? AND run_id = ?").run(
        EXECUTION_LEASE_NAME,
        id
      );
      return getAgentRun(id);
    }
    const active = db
      .prepare(`
        UPDATE agent_runs
        SET cancellation_requested = 1, updated_at = ?
        WHERE id = ? AND state IN ('previewing', 'executing', 'verifying')
      `)
      .run(timestamp, id);
    return active.changes === 1 ? getAgentRun(id) : null;
  }).immediate();
}

export function claimNextPreview(workerId: string, leaseDurationMs = 30_000): AgentRun | null {
  const owner = requireWorkerId(workerId);
  const db = getDatabase();
  return db.transaction(() => {
    const row = db
      .prepare("SELECT id FROM agent_runs WHERE state = 'queued_preview' ORDER BY created_at, id LIMIT 1")
      .get() as { id: string } | undefined;
    if (!row) {
      return null;
    }
    const updated = db
      .prepare(`
        UPDATE agent_runs
        SET state = 'previewing', worker_id = ?, lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND state = 'queued_preview'
      `)
      .run(owner, leaseExpiryIso(leaseDurationMs), nowIso(), row.id);
    return updated.changes === 1 ? getAgentRun(row.id) : null;
  }).immediate();
}

export function claimNextExecution(workerId: string, leaseDurationMs = 30_000): AgentRun | null {
  const owner = requireWorkerId(workerId);
  const db = getDatabase();
  return db.transaction(() => {
    const timestamp = nowIso();
    const existingLease = db
      .prepare("SELECT worker_id, run_id, expires_at FROM agent_worker_leases WHERE name = ?")
      .get(EXECUTION_LEASE_NAME) as
      | { worker_id: string; run_id: string; expires_at: string }
      | undefined;
    if (existingLease && existingLease.expires_at > timestamp) {
      return null;
    }
    if (existingLease) {
      const leasedRun = db.prepare("SELECT state, worker_id FROM agent_runs WHERE id = ?").get(
        existingLease.run_id
      ) as { state: string; worker_id: string | null } | undefined;
      if (
        leasedRun &&
        (leasedRun.state === "executing" || leasedRun.state === "verifying")
      ) {
        const interrupted = db
          .prepare(`
            UPDATE agent_runs
            SET state = 'interrupted', worker_id = NULL, lease_expires_at = NULL, updated_at = ?
            WHERE id = ? AND state IN ('executing', 'verifying') AND worker_id = ?
          `)
          .run(timestamp, existingLease.run_id, existingLease.worker_id);
        if (interrupted.changes !== 1) {
          return null;
        }
      }
      db.prepare(`
        DELETE FROM agent_worker_leases
        WHERE name = ? AND worker_id = ? AND run_id = ? AND expires_at = ?
      `).run(
        EXECUTION_LEASE_NAME,
        existingLease.worker_id,
        existingLease.run_id,
        existingLease.expires_at
      );
    }
    const row = db
      .prepare("SELECT id FROM agent_runs WHERE state = 'queued_execution' ORDER BY created_at, id LIMIT 1")
      .get() as { id: string } | undefined;
    if (!row) {
      return null;
    }
    const expiresAt = leaseExpiryIso(leaseDurationMs);
    const acquired = db
      .prepare(`
        INSERT INTO agent_worker_leases (name, worker_id, run_id, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(name) DO NOTHING
      `)
      .run(EXECUTION_LEASE_NAME, owner, row.id, expiresAt, timestamp);
    if (acquired.changes !== 1) {
      return null;
    }
    const updated = db
      .prepare(`
        UPDATE agent_runs
        SET state = 'executing', worker_id = ?, lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND state = 'queued_execution'
      `)
      .run(owner, expiresAt, timestamp, row.id);
    if (updated.changes !== 1) {
      db.prepare("DELETE FROM agent_worker_leases WHERE name = ? AND worker_id = ?").run(
        EXECUTION_LEASE_NAME,
        owner
      );
      return null;
    }
    return getAgentRun(row.id);
  }).immediate();
}

export function renewAgentRunLease(
  id: string,
  workerId: string,
  leaseDurationMs = 30_000
): boolean {
  const owner = requireWorkerId(workerId);
  const db = getDatabase();
  return db.transaction(() => {
    const timestamp = nowIso();
    const run = db
      .prepare("SELECT state, worker_id, lease_expires_at FROM agent_runs WHERE id = ?")
      .get(id) as
      | { state: string; worker_id: string | null; lease_expires_at: string | null }
      | undefined;
    if (
      !run ||
      !ACTIVE_STATES.has(run.state as AgentRunState) ||
      run.worker_id !== owner ||
      !run.lease_expires_at ||
      run.lease_expires_at <= timestamp
    ) {
      return false;
    }

    const expiresAt = leaseExpiryIso(leaseDurationMs);
    if (run.state === "previewing") {
      return db
        .prepare(`
          UPDATE agent_runs
          SET lease_expires_at = ?, updated_at = ?
          WHERE id = ? AND state = 'previewing' AND worker_id = ? AND lease_expires_at = ?
        `)
        .run(expiresAt, timestamp, id, owner, run.lease_expires_at).changes === 1;
    }

    const lease = db
      .prepare(`
        SELECT worker_id, run_id, expires_at
        FROM agent_worker_leases
        WHERE name = ?
      `)
      .get(EXECUTION_LEASE_NAME) as
      | { worker_id: string; run_id: string; expires_at: string }
      | undefined;
    if (
      !lease ||
      lease.worker_id !== owner ||
      lease.run_id !== id ||
      lease.expires_at !== run.lease_expires_at ||
      lease.expires_at <= timestamp
    ) {
      return false;
    }

    const runUpdate = db
      .prepare(`
        UPDATE agent_runs
        SET lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND state = ? AND worker_id = ? AND lease_expires_at = ?
      `)
      .run(expiresAt, timestamp, id, run.state, owner, run.lease_expires_at);
    const leaseUpdate = db
      .prepare(`
        UPDATE agent_worker_leases
        SET expires_at = ?, updated_at = ?
        WHERE name = ? AND worker_id = ? AND run_id = ? AND expires_at = ?
      `)
      .run(expiresAt, timestamp, EXECUTION_LEASE_NAME, owner, id, lease.expires_at);
    if (runUpdate.changes !== 1 || leaseUpdate.changes !== 1) {
      throw new Error("Agent lease renewal failed");
    }
    return true;
  }).immediate();
}

export function recoverAbandonedAgentRuns(workerId: string): number {
  const owner = requireWorkerId(workerId);
  const db = getDatabase();
  return db.transaction(() => {
    const timestamp = nowIso();
    const abandoned = db
      .prepare(`
        SELECT id
        FROM agent_runs
        WHERE state IN ('previewing', 'executing', 'verifying')
          AND worker_id IS NOT NULL
          AND (worker_id <> ? OR lease_expires_at IS NULL OR lease_expires_at <= ?)
      `)
      .all(owner, timestamp) as Array<{ id: string }>;
    if (abandoned.length === 0) {
      db.prepare("DELETE FROM agent_worker_leases WHERE expires_at <= ?").run(timestamp);
      return 0;
    }
    const update = db.prepare(`
      UPDATE agent_runs
      SET state = 'interrupted', worker_id = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND state IN ('previewing', 'executing', 'verifying')
    `);
    for (const row of abandoned) {
      update.run(timestamp, row.id);
      db.prepare("DELETE FROM agent_worker_leases WHERE run_id = ?").run(row.id);
    }
    db.prepare("DELETE FROM agent_worker_leases WHERE expires_at <= ?").run(timestamp);
    return abandoned.length;
  }).immediate();
}

export function resetAgentRunStorageForTests() {
  if (cachedDatabase?.db.open) {
    cachedDatabase.db.close();
  }
  cachedDatabase = null;
  lastTimestampMs = 0;
}
