import path from "node:path";

import Database from "better-sqlite3";

import { runJsonCommand, type JsonCommandSpawn } from "./process";
import type { AgentProvider } from "./providers";
import { sanitizeProviderEvent, verifyArtifactPath } from "./security";
import {
  appendAgentRunEvent,
  claimNextExecution,
  claimNextPreview,
  getAgentRun,
  interruptOwnedAgentRun,
  recoverAbandonedAgentRuns,
  renewAgentRunLease,
  transitionOwnedAgentRun
} from "./storage";
import type {
  AgentPreview,
  AgentProviderName,
  AgentRun,
  AgentRunState,
  ArtifactManifestEntry
} from "./types";

const UPSERT_AUDIT_NOTE_PREFIX = "Approved JobTracker agent preview; host-controlled upsert for run";
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_POLL_MS = 250;

export type AgentOrchestratorDependencies = {
  workerId: string;
  projectRoot: string;
  dbPath: string;
  applicationsDir: string;
  providers: Record<AgentProviderName, AgentProvider>;
  profileContext?: string;
  resumeContext?: string;
  baseResumePath?: string;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  commandTimeoutMs?: number;
  spawn?: JsonCommandSpawn;
  signal?: AbortSignal;
};

export type AgentWorkerOptions = AgentOrchestratorDependencies & {
  pollIntervalMs?: number;
};

type PhaseStop = "cancelled" | "lost_lease";

class PhaseStoppedError extends Error {
  constructor(readonly reason: PhaseStop) {
    super(reason);
  }
}

class SafeWorkflowError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export async function processNextAgentRun(
  dependencies: AgentOrchestratorDependencies
): Promise<boolean> {
  const leaseDurationMs = dependencies.leaseDurationMs ?? DEFAULT_LEASE_MS;
  const execution = claimNextExecution(dependencies.workerId, leaseDurationMs);
  if (execution) {
    await processExecution(execution, dependencies);
    return true;
  }
  const preview = claimNextPreview(dependencies.workerId, leaseDurationMs);
  if (preview) {
    await processPreview(preview, dependencies);
    return true;
  }
  return false;
}

export async function runAgentWorker(options: AgentWorkerOptions): Promise<void> {
  recoverAbandonedAgentRuns(options.workerId);
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  while (!options.signal?.aborted) {
    const worked = await processNextAgentRun(options);
    if (!worked) await abortableDelay(pollIntervalMs, options.signal);
  }
}

async function processPreview(run: AgentRun, deps: AgentOrchestratorDependencies) {
  appendAgentRunEvent(run.id, { kind: "status", message: "Preview started." });
  try {
    const result = await activePhase(run.id, deps, (signal) =>
      deps.providers[run.provider].preview(
        {
          jobUrl: run.canonicalJobUrl,
          model: run.model,
          profileContext: deps.profileContext,
          resumeContext: deps.resumeContext ?? deps.baseResumePath,
          signal
        },
        {
          onEvent: (event) => {
            const safe = sanitizeProviderEvent(event);
            appendAgentRunEvent(run.id, {
              kind: safe.kind,
              message: safe.message,
              metadata: safe.metadata
            });
          }
        }
      )
    );
    const transitioned = transitionOwnedAgentRun(run.id, deps.workerId, "previewing", "awaiting_approval", {
      preview: result.preview,
      usage: result.usage
    });
    if (!transitioned) throw new PhaseStoppedError(resolveStop(run.id));
    appendAgentRunEvent(run.id, { kind: "status", message: "Preview ready for approval." });
  } catch (error) {
    finishActiveFailure(run.id, deps.workerId, "previewing", error, "preview_failed", "Preview failed.");
  } finally {
    interruptOwnedAgentRun(run.id, deps.workerId);
  }
}

async function processExecution(run: AgentRun, deps: AgentOrchestratorDependencies) {
  appendAgentRunEvent(run.id, { kind: "status", message: "Execution started." });
  let artifactSnapshot: ArtifactRegistrationSnapshot | null = null;
  try {
    if (!run.preview) throw new SafeWorkflowError("approved_preview_missing", "Approved preview is missing.");
    const auditNote = `${UPSERT_AUDIT_NOTE_PREFIX} ${run.id}`;
    const beforeUpsert = snapshotUpsertState(deps.dbPath, run.preview);
    const upsertStartedAt = new Date().toISOString();
    const upsert = await activePhase(run.id, deps, (signal) =>
      runJsonCommand(
        process.execPath,
        [path.join(deps.projectRoot, "scripts", "upsert-job-posting.mjs"), "--input-json", "-", "--reactivate"],
        upsertPayload(run.preview!, run.canonicalJobUrl, auditNote),
        commandOptions(deps, signal)
      )
    );
    const applicationId = validateUpsert(upsert, run.preview, run.canonicalJobUrl);
    verifyUpsertReadback(
      deps.dbPath,
      applicationId,
      run.preview,
      run.canonicalJobUrl,
      upsert,
      beforeUpsert,
      auditNote,
      upsertStartedAt
    );

    const materials = await activePhase(run.id, deps, (signal) =>
      deps.providers[run.provider].createMaterials(
        {
          jobUrl: run.canonicalJobUrl,
          model: run.model,
          preview: run.preview!,
          profileContext: deps.profileContext,
          resumeContext: deps.resumeContext ?? deps.baseResumePath,
          signal
        },
        {
          onEvent: (event) => {
            const safe = sanitizeProviderEvent(event);
            appendAgentRunEvent(run.id, { kind: safe.kind, message: safe.message, metadata: safe.metadata });
          }
        }
      )
    );
    const verifying = transitionOwnedAgentRun(run.id, deps.workerId, "executing", "verifying", {
      applicationId,
      artifactManifest: materials.manifest,
      usage: materials.usage
    });
    if (!verifying) throw new PhaseStoppedError(resolveStop(run.id));
    appendAgentRunEvent(run.id, { kind: "status", message: "Artifact verification started." });

    const manifest = await activePhase(run.id, deps, () =>
      reconcileManifest(materials.manifest, deps.applicationsDir)
    );
    artifactSnapshot = snapshotArtifactState(deps.dbPath, applicationId, manifest);
    const links = [];
    for (const entry of manifest) {
      const registrationStartedAt = new Date().toISOString();
      const registered = await activePhase(run.id, deps, (signal) =>
        runJsonCommand(
          process.execPath,
          [
            path.join(deps.projectRoot, "scripts", "register-application-artifact.mjs"),
            "--db", deps.dbPath,
            "--application-id", applicationId,
            "--type", entry.type,
            "--title", entry.title,
            "--file", entry.filePath,
            "--content-type", entry.contentType
          ],
          {},
          commandOptions(deps, signal)
        )
      );
      const artifact = validateRegistration(registered, applicationId, entry);
      verifyRegistrationReadback(
        deps.dbPath,
        artifact,
        applicationId,
        entry,
        artifactSnapshot,
        registrationStartedAt
      );
      links.push({
        id: artifact.id,
        type: entry.type,
        title: entry.title,
        href: `/api/applications/${applicationId}/artifacts/${artifact.id}/file`
      });
    }
    const completed = transitionOwnedAgentRun(run.id, deps.workerId, "verifying", "succeeded", {
      artifactManifest: manifest,
      artifactLinks: links
    });
    if (!completed) throw new PhaseStoppedError(resolveStop(run.id));
    artifactSnapshot = null;
    appendAgentRunEvent(run.id, { kind: "status", message: "Application materials completed." });
  } catch (error) {
    if (artifactSnapshot) compensateArtifactRegistrations(deps.dbPath, artifactSnapshot);
    const current = getAgentRun(run.id);
    const state = current?.state === "verifying" ? "verifying" : "executing";
    const code = error instanceof SafeWorkflowError ? error.code : state === "verifying"
      ? "artifact_reconciliation_failed"
      : "execution_failed";
    finishActiveFailure(run.id, deps.workerId, state, error, code, state === "verifying" ? "Artifact reconciliation failed." : "Execution failed.");
  } finally {
    interruptOwnedAgentRun(run.id, deps.workerId);
  }
}

async function activePhase<T>(
  runId: string,
  deps: AgentOrchestratorDependencies,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const leaseDurationMs = deps.leaseDurationMs ?? DEFAULT_LEASE_MS;
  const heartbeatIntervalMs = deps.heartbeatIntervalMs ?? Math.min(250, Math.max(25, Math.floor(leaseDurationMs / 3)));
  let stopped: PhaseStop | null = null;
  let checking = false;
  const check = () => {
    if (checking || stopped) return;
    checking = true;
    try {
      const current = getAgentRun(runId);
      if (!current || current.cancellationRequested) {
        stopped = "cancelled";
        controller.abort();
      } else if (!renewAgentRunLease(runId, deps.workerId, leaseDurationMs)) {
        stopped = "lost_lease";
        controller.abort();
      }
    } finally {
      checking = false;
    }
  };
  const interval = setInterval(check, heartbeatIntervalMs);
  interval.unref();
  const onWorkerAbort = () => {
    stopped = "lost_lease";
    controller.abort();
  };
  deps.signal?.addEventListener("abort", onWorkerAbort, { once: true });
  try {
    const value = await operation(controller.signal);
    const current = getAgentRun(runId);
    if (current?.cancellationRequested) stopped = "cancelled";
    if (stopped) throw new PhaseStoppedError(stopped);
    return value;
  } catch (error) {
    if (stopped) throw new PhaseStoppedError(stopped);
    throw error;
  } finally {
    clearInterval(interval);
    deps.signal?.removeEventListener("abort", onWorkerAbort);
  }
}

function finishActiveFailure(
  runId: string,
  workerId: string,
  expectedState: "previewing" | "executing" | "verifying",
  error: unknown,
  failureCode: string,
  failureMessage: string
) {
  const stop = error instanceof PhaseStoppedError ? error.reason : null;
  const nextState: AgentRunState = stop === "cancelled" ? "cancelled" : stop === "lost_lease" ? "interrupted" : "failed";
  const transitioned = transitionOwnedAgentRun(
    runId,
    workerId,
    expectedState,
    nextState,
    nextState === "failed" ? { failureCode, failureMessage } : {}
  );
  if (!transitioned) return;
  appendAgentRunEvent(runId, {
    kind: nextState === "failed" ? "error" : "status",
    message: nextState === "cancelled" ? "Run cancelled." : nextState === "interrupted" ? "Run interrupted." : failureMessage
  });
}

function resolveStop(runId: string): PhaseStop {
  return getAgentRun(runId)?.cancellationRequested ? "cancelled" : "lost_lease";
}

function upsertPayload(preview: AgentPreview, canonicalJobUrl: string, auditNote: string) {
  return {
    company: preview.company,
    role: preview.role,
    url: canonicalJobUrl,
    source: new URL(canonicalJobUrl).hostname.toLowerCase().replace(/^www\./, ""),
    location: preview.location,
    summary: preview.summary,
    posting_state: preview.postingState,
    note: auditNote
  };
}

function validateUpsert(value: unknown, preview: AgentPreview, url: string): string {
  const output = record(value, "upsert_output_invalid");
  if (output.action !== "created" && output.action !== "updated") invalid("upsert_output_invalid");
  const application = record(output.application, "upsert_output_invalid");
  if (
    application.company !== preview.company ||
    application.role !== preview.role ||
    application.url !== url ||
    typeof application.id !== "string" || !application.id ||
    typeof application.status !== "string" || ["archived", "rejected"].includes(application.status)
  ) invalid("upsert_output_invalid");
  if (!Array.isArray(output.changes) || !output.changes.every((item) => typeof item === "string")) invalid("upsert_output_invalid");
  if (!Array.isArray(output.noteIds) || output.noteIds.length === 0 || !output.noteIds.every((item) => typeof item === "string" && item)) invalid("upsert_output_invalid");
  return application.id as string;
}

type ApplicationSnapshot = {
  id: string;
  company: string;
  role: string;
  status: string;
  source: string | null;
  location: string | null;
  url: string | null;
  contact: string | null;
  notes: string | null;
  updated_at: string;
};

type UpsertSnapshot = {
  application: ApplicationSnapshot | null;
  noteIds: Set<string>;
};

function normalizeDuplicateKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function snapshotUpsertState(dbPath: string, preview: AgentPreview): UpsertSnapshot {
  const db = new Database(dbPath, { readonly: true });
  try {
    if (!tableExists(db, "applications")) return { application: null, noteIds: new Set() };
    const matches = (db.prepare(`
      SELECT id, company, role, status, source, location, url, contact, notes, updated_at
      FROM applications
    `).all() as ApplicationSnapshot[]).filter(
      (row) => normalizeDuplicateKey(row.company) === normalizeDuplicateKey(preview.company) &&
        normalizeDuplicateKey(row.role) === normalizeDuplicateKey(preview.role)
    );
    if (matches.length > 1) invalid("upsert_readback_invalid");
    const application = matches[0] ?? null;
    const noteIds = new Set<string>();
    if (application && tableExists(db, "application_notes")) {
      for (const row of db.prepare("SELECT id FROM application_notes WHERE application_id = ?").all(application.id) as Array<{ id: string }>) {
        noteIds.add(row.id);
      }
    }
    return { application, noteIds };
  } finally {
    db.close();
  }
}

function verifyUpsertReadback(
  dbPath: string,
  id: string,
  preview: AgentPreview,
  url: string,
  outputValue: unknown,
  before: UpsertSnapshot,
  auditNote: string,
  startedAt: string
) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const output = record(outputValue, "upsert_readback_invalid");
    const returnedApplication = record(output.application, "upsert_readback_invalid");
    const application = db.prepare(`
      SELECT id, company, role, status, source, location, url, contact, notes, updated_at
      FROM applications WHERE id = ?
    `).get(id) as ApplicationSnapshot | undefined;
    const expectedAction = before.application ? "updated" : "created";
    if (
      output.action !== expectedAction || !application ||
      (before.application !== null && id !== before.application.id) ||
      application.company !== preview.company || application.role !== preview.role || application.url !== url ||
      ["archived", "rejected"].includes(application.status) || returnedApplication.status !== application.status ||
      returnedApplication.company !== application.company || returnedApplication.role !== application.role ||
      returnedApplication.url !== application.url
    ) invalid("upsert_readback_invalid");
    const expectedChanges = deriveUpsertChanges(before.application, application);
    if (JSON.stringify(output.changes) !== JSON.stringify(expectedChanges)) invalid("upsert_readback_invalid");
    const noteIds = output.noteIds as string[];
    if (noteIds.length !== 1) invalid("upsert_readback_invalid");
    for (const noteId of noteIds) {
      if (before.noteIds.has(noteId)) invalid("upsert_readback_invalid");
      const note = db.prepare("SELECT application_id, body, created_at FROM application_notes WHERE id = ?").get(noteId) as
        | { application_id: string; body: string; created_at: string }
        | undefined;
      if (
        !note || note.application_id !== id || note.created_at < startedAt ||
        !note.body.includes(`note: ${auditNote}.`)
      ) invalid("upsert_readback_invalid");
    }
  } catch {
    invalid("upsert_readback_invalid");
  } finally {
    db.close();
  }
}

function deriveUpsertChanges(before: ApplicationSnapshot | null, after: ApplicationSnapshot): string[] {
  if (!before) return ["created new application record"];
  const changes: string[] = [];
  const add = (field: keyof ApplicationSnapshot, label: string) => {
    if (before[field] !== after[field]) {
      changes.push(`${label}: ${String(before[field] || "blank")} -> ${String(after[field])}`);
    }
  };
  add("source", "source");
  add("location", "location");
  add("url", "url");
  add("contact", "contact");
  add("notes", "summary");
  add("status", "status");
  return changes;
}

async function reconcileManifest(entries: ArtifactManifestEntry[], root: string): Promise<ArtifactManifestEntry[]> {
  if (!Array.isArray(entries) || entries.length === 0) invalid("artifact_reconciliation_failed");
  const reconciled: ArtifactManifestEntry[] = [];
  const paths = new Set<string>();
  let hasFitAnalysis = false;
  for (const entry of entries) {
    validateArtifactCombination(entry);
    const filePath = await verifyArtifactPath(root, entry.filePath);
    if (paths.has(filePath)) invalid("artifact_reconciliation_failed");
    paths.add(filePath);
    if (entry.type === "fit_analysis") hasFitAnalysis = true;
    reconciled.push({ ...entry, filePath });
  }
  if (!hasFitAnalysis) invalid("artifact_reconciliation_failed");
  return reconciled;
}

function validateArtifactCombination(entry: ArtifactManifestEntry) {
  if (!entry.title.trim()) invalid("artifact_reconciliation_failed");
  const extension = path.extname(entry.filePath).toLowerCase();
  const valid = entry.type === "resume"
    ? (entry.contentType === "application/pdf" && extension === ".pdf") ||
      (entry.contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && extension === ".docx")
    : entry.type === "posting"
      ? (entry.contentType === "text/markdown" && extension === ".md") || (entry.contentType === "application/pdf" && extension === ".pdf")
      : entry.contentType === "text/markdown" && extension === ".md";
  if (!valid) invalid("artifact_reconciliation_failed");
}

type ArtifactRow = {
  id: string;
  application_id: string;
  type: string;
  title: string;
  file_path: string;
  content_type: string;
  created_at: string;
  updated_at: string;
};

type ArtifactRegistrationSnapshot = {
  applicationId: string;
  applicationUpdatedAt: string;
  entries: ArtifactManifestEntry[];
  rows: Map<string, ArtifactRow>;
};

type RegistrationOutput = {
  id: string;
  createdAt: string;
  updatedAt: string;
};

function artifactKey(type: string, filePath: string) {
  return `${type}\0${filePath}`;
}

function snapshotArtifactState(
  dbPath: string,
  applicationId: string,
  entries: ArtifactManifestEntry[]
): ArtifactRegistrationSnapshot {
  const db = new Database(dbPath, { readonly: true });
  try {
    const application = db.prepare("SELECT updated_at FROM applications WHERE id = ?").get(applicationId) as
      | { updated_at: string }
      | undefined;
    if (!application) invalid("artifact_reconciliation_failed");
    const rows = new Map<string, ArtifactRow>();
    if (tableExists(db, "application_artifacts")) {
      const statement = db.prepare(`
        SELECT id, application_id, type, title, file_path, content_type, created_at, updated_at
        FROM application_artifacts WHERE application_id = ? AND type = ? AND file_path = ?
      `);
      for (const entry of entries) {
        const row = statement.get(applicationId, entry.type, entry.filePath) as ArtifactRow | undefined;
        if (row) rows.set(artifactKey(entry.type, entry.filePath), row);
      }
    }
    return { applicationId, applicationUpdatedAt: application.updated_at, entries, rows };
  } finally {
    db.close();
  }
}

function compensateArtifactRegistrations(dbPath: string, snapshot: ArtifactRegistrationSnapshot) {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  try {
    db.transaction(() => {
      if (tableExists(db, "application_artifacts")) {
        const remove = db.prepare(`
          DELETE FROM application_artifacts
          WHERE application_id = ? AND type = ? AND file_path = ?
        `);
        const restore = db.prepare(`
          INSERT INTO application_artifacts (
            id, application_id, type, title, file_path, content_type, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const entry of snapshot.entries) {
          remove.run(snapshot.applicationId, entry.type, entry.filePath);
          const row = snapshot.rows.get(artifactKey(entry.type, entry.filePath));
          if (row) {
            restore.run(
              row.id,
              row.application_id,
              row.type,
              row.title,
              row.file_path,
              row.content_type,
              row.created_at,
              row.updated_at
            );
          }
        }
      }
      db.prepare("UPDATE applications SET updated_at = ? WHERE id = ?").run(
        snapshot.applicationUpdatedAt,
        snapshot.applicationId
      );
    }).immediate();
  } finally {
    db.close();
  }
}

function validateRegistration(
  value: unknown,
  applicationId: string,
  entry: ArtifactManifestEntry
): RegistrationOutput {
  const output = record(value, "artifact_registration_invalid");
  const artifact = record(output.artifact, "artifact_registration_invalid");
  if (
    output.action !== "registered" ||
    typeof artifact.id !== "string" || !artifact.id ||
    artifact.applicationId !== applicationId || artifact.type !== entry.type ||
    artifact.title !== entry.title || artifact.filePath !== entry.filePath || artifact.contentType !== entry.contentType ||
    typeof artifact.createdAt !== "string" || typeof artifact.updatedAt !== "string"
  ) invalid("artifact_registration_invalid");
  return {
    id: artifact.id as string,
    createdAt: artifact.createdAt as string,
    updatedAt: artifact.updatedAt as string
  };
}

function verifyRegistrationReadback(
  dbPath: string,
  output: RegistrationOutput,
  applicationId: string,
  entry: ArtifactManifestEntry,
  snapshot: ArtifactRegistrationSnapshot,
  startedAt: string
) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare(`
      SELECT id, application_id, type, title, file_path, content_type, created_at, updated_at
      FROM application_artifacts WHERE id = ?
    `).get(output.id) as ArtifactRow | undefined;
    const previous = snapshot.rows.get(artifactKey(entry.type, entry.filePath));
    if (
      !row || row.application_id !== applicationId || row.type !== entry.type ||
      row.title !== entry.title || row.file_path !== entry.filePath || row.content_type !== entry.contentType ||
      row.created_at !== output.createdAt || row.updated_at !== output.updatedAt || row.updated_at < startedAt ||
      (previous ? row.id !== previous.id || row.created_at !== previous.created_at : row.created_at < startedAt)
    ) invalid("artifact_registration_readback_invalid");
  } catch {
    invalid("artifact_registration_readback_invalid");
  } finally {
    db.close();
  }
}

function tableExists(db: Database.Database, name: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function commandOptions(deps: AgentOrchestratorDependencies, signal: AbortSignal) {
  return {
    cwd: deps.projectRoot,
    environment: { JOBTRACKER_DB_PATH: deps.dbPath },
    signal,
    timeoutMs: deps.commandTimeoutMs,
    spawn: deps.spawn
  };
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(code);
  return value as Record<string, unknown>;
}

function invalid(code: string): never {
  throw new SafeWorkflowError(code, "Workflow output validation failed.");
}

async function abortableDelay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, ms);
    const onAbort = () => done();
    function done() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
