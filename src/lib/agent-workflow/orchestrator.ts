import path from "node:path";

import Database from "better-sqlite3";

import { runJsonCommand, type JsonCommandSpawn } from "./process";
import type { AgentProvider } from "./providers";
import {
  PostingRetrievalError,
  retrievePublicPosting,
  type RetrievedPosting
} from "./retrieval";
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
  retrievePosting?: typeof retrievePublicPosting;
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
    let worked = true;
    try {
      worked = await processNextAgentRun(options);
    } catch {
      // A single corrupt run must not terminate the local worker loop.
      worked = false;
    }
    if (!worked) await abortableDelay(pollIntervalMs, options.signal);
  }
}

async function processPreview(run: AgentRun, deps: AgentOrchestratorDependencies) {
  appendAgentRunEvent(run.id, { kind: "status", message: "Validating public job URL." });
  try {
    let posting: RetrievedPosting;
    let retrievalStageEmitted = false;
    try {
      posting = await activePhase(run.id, deps, (signal) =>
        (deps.retrievePosting ?? retrievePublicPosting)(run.canonicalJobUrl, {
          signal,
          onInitialValidated: () => {
            if (retrievalStageEmitted) return;
            retrievalStageEmitted = true;
            appendAgentRunEvent(run.id, { kind: "status", message: "Retrieving public job posting." });
          }
        })
      );
    } catch (error) {
      if (error instanceof PostingRetrievalError) {
        throw new SafeWorkflowError(
          "posting_retrieval_failed",
          "The public job posting could not be retrieved safely. Check the link or try another public posting URL."
        );
      }
      throw error;
    }
    if (!posting.context.trim()) {
      throw new SafeWorkflowError(
        "posting_retrieval_failed",
        "The public job posting could not be retrieved safely. Check the link or try another public posting URL."
      );
    }
    appendAgentRunEvent(run.id, { kind: "status", message: "Analyzing job posting." });
    const result = await activePhase(run.id, deps, (signal) =>
      deps.providers[run.provider].preview(
        {
          jobUrl: run.canonicalJobUrl,
          postingContext: posting.context,
          postingFinalUrl: posting.finalUrl,
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
    if (!isUsablePreview(result.preview, posting.context)) {
      throw new SafeWorkflowError(
        "preview_unusable",
        "The job posting could not be identified reliably. Try another public posting URL."
      );
    }
    const transitioned = transitionOwnedAgentRun(run.id, deps.workerId, "previewing", "awaiting_approval", {
      preview: result.preview,
      usage: result.usage
    });
    if (!transitioned) throw new PhaseStoppedError(resolveStop(run.id));
    appendAgentRunEvent(run.id, { kind: "status", message: "Preview ready for approval." });
  } catch (error) {
    const safePreviewFailure = error instanceof SafeWorkflowError &&
      (error.code === "posting_retrieval_failed" || error.code === "preview_unusable");
    finishActiveFailure(
      run.id,
      deps.workerId,
      "previewing",
      error,
      safePreviewFailure ? error.code : "preview_failed",
      safePreviewFailure ? error.message : "Preview failed."
    );
  } finally {
    interruptOwnedAgentRun(run.id, deps.workerId);
  }
}

const UNUSABLE_PREVIEW_VALUES = new Set(["unknown", "unavailable", "not found", "n/a", "null"]);
const UNUSABLE_ROLE_VALUES = new Set(["sign in", "login", "log in", "access denied", "page not found"]);
const SUMMARY_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is",
  "it", "of", "on", "or", "that", "the", "their", "this", "to", "with", "you", "your"
]);
const MINIMUM_SUMMARY_TERMS = 3;
const MINIMUM_SUMMARY_OVERLAP = 0.6;

export function isUsablePreview(preview: AgentPreview, postingContext: string): boolean {
  const company = normalizeGroundingText(preview.company);
  const role = normalizeGroundingText(preview.role);
  const summary = normalizeGroundingText(preview.summary);
  const context = normalizeGroundingText(postingContext);
  return Boolean(company && role && summary) &&
    Boolean(context) &&
    !UNUSABLE_PREVIEW_VALUES.has(company) &&
    !UNUSABLE_PREVIEW_VALUES.has(role) &&
    !UNUSABLE_ROLE_VALUES.has(role) &&
    containsNormalizedPhrase(context, company) &&
    containsNormalizedPhrase(context, role) &&
    hasGroundedSummary(summary, context);
}

function normalizeGroundingText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function containsNormalizedPhrase(context: string, phrase: string): boolean {
  return ` ${context} `.includes(` ${phrase} `);
}

function hasGroundedSummary(summary: string, context: string): boolean {
  const meaningfulTerms = [...new Set(
    summary.split(" ").filter((term) => term.length >= 3 && !SUMMARY_STOPWORDS.has(term))
  )];
  if (meaningfulTerms.length < MINIMUM_SUMMARY_TERMS) return false;
  const contextTerms = new Set(context.split(" "));
  const matchedTerms = meaningfulTerms.filter((term) => contextTerms.has(term)).length;
  const requiredMatches = Math.max(
    MINIMUM_SUMMARY_TERMS,
    Math.ceil(MINIMUM_SUMMARY_OVERLAP * meaningfulTerms.length)
  );
  return matchedTerms >= requiredMatches;
}

async function processExecution(run: AgentRun, deps: AgentOrchestratorDependencies) {
  appendAgentRunEvent(run.id, { kind: "status", message: "Execution started." });
  const artifactLedger: ArtifactMutation[] = [];
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
    const upsertFinishedAt = new Date().toISOString();
    const applicationId = validateUpsert(upsert, run.preview, run.canonicalJobUrl);
    verifyUpsertReadback(
      deps.dbPath,
      applicationId,
      run.preview,
      run.canonicalJobUrl,
      upsert,
      beforeUpsert,
      auditNote,
      upsertStartedAt,
      upsertFinishedAt
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
    const links = [];
    for (const [entryIndex, entry] of manifest.entries()) {
      const beforeRegistration = snapshotRegistrationKey(deps.dbPath, applicationId, entry);
      const registrationStartedAt = new Date().toISOString();
      let registered: unknown;
      try {
        registered = await activePhase(run.id, deps, (signal) =>
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
      } catch (error) {
        ledgerCommittedRegistration(
          deps.dbPath,
          entry,
          beforeRegistration,
          registrationStartedAt,
          new Date().toISOString(),
          artifactLedger
        );
        throw error;
      }
      const mutation = ledgerCommittedRegistration(
        deps.dbPath,
        entry,
        beforeRegistration,
        registrationStartedAt,
        new Date().toISOString(),
        artifactLedger
      );
      const artifact = validateRegistration(registered, applicationId, entry);
      verifyRegistrationReadback(
        deps.dbPath,
        artifact,
        applicationId,
        entry,
        mutation
      );
      links.push({
        id: artifact.id,
        type: entry.type,
        title: entry.title,
        href: `/api/applications/${applicationId}/artifacts/${artifact.id}/file`
      });
      if (entryIndex < manifest.length - 1) await yieldToEventLoop();
    }
    const completed = transitionOwnedAgentRun(run.id, deps.workerId, "verifying", "succeeded", {
      artifactManifest: manifest,
      artifactLinks: links
    });
    if (!completed) throw new PhaseStoppedError(resolveStop(run.id));
    artifactLedger.length = 0;
    appendAgentRunEvent(run.id, { kind: "status", message: "Application materials completed." });
  } catch (error) {
    let compensationFailed = false;
    if (artifactLedger.length > 0) {
      try {
        compensateArtifactRegistrations(deps.dbPath, artifactLedger);
      } catch {
        compensationFailed = true;
      }
    }
    const current = getAgentRun(run.id);
    const state = current?.state === "verifying" ? "verifying" : "executing";
    const code = compensationFailed
      ? "artifact_compensation_failed"
      : error instanceof SafeWorkflowError ? error.code : state === "verifying"
        ? "artifact_reconciliation_failed"
        : "execution_failed";
    const message = compensationFailed
      ? "Artifact rollback failed."
      : state === "verifying" ? "Artifact reconciliation failed." : "Execution failed.";
    finishActiveFailure(
      run.id,
      deps.workerId,
      state,
      compensationFailed ? new SafeWorkflowError(code, message) : error,
      code,
      message
    );
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
    check();
    if (stopped) throw new PhaseStoppedError(stopped);
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
  startedAt: string,
  finishedAt: string
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
      returnedApplication.url !== application.url || returnedApplication.source !== application.source ||
      typeof application.source !== "string"
    ) invalid("upsert_readback_invalid");
    const expectedChanges = deriveUpsertChanges(before.application, application);
    if (JSON.stringify(output.changes) !== JSON.stringify(expectedChanges)) invalid("upsert_readback_invalid");
    const expectedNoteBody = buildExpectedAuditBody(
      expectedAction,
      application.source,
      url,
      preview.postingState,
      expectedChanges,
      auditNote
    );
    const noteIds = output.noteIds as string[];
    if (noteIds.length !== 1) invalid("upsert_readback_invalid");
    for (const noteId of noteIds) {
      if (before.noteIds.has(noteId)) invalid("upsert_readback_invalid");
      const note = db.prepare("SELECT application_id, body, created_at FROM application_notes WHERE id = ?").get(noteId) as
        | { application_id: string; body: string; created_at: string }
        | undefined;
      if (
        !note || note.application_id !== id || note.created_at < startedAt || note.created_at > finishedAt ||
        note.body !== expectedNoteBody
      ) invalid("upsert_readback_invalid");
    }
  } catch {
    invalid("upsert_readback_invalid");
  } finally {
    db.close();
  }
}

function buildExpectedAuditBody(
  action: "created" | "updated",
  source: string,
  url: string,
  postingState: AgentPreview["postingState"],
  changes: string[],
  auditNote: string
) {
  const actionLabel = action === "created" ? "Added tracker record" : "Reviewed existing tracker record";
  const fragments = [`${actionLabel} from public posting`, `source: ${source}`, `url: ${url}`];
  if (postingState !== "unknown") fragments.push(`posting state: ${postingState}`);
  fragments.push(changes.length ? `changes: ${changes.join("; ")}` : "changes: none");
  fragments.push(`note: ${auditNote}`);
  return `${fragments.join(". ")}.`;
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

type RegistrationKeySnapshot = {
  applicationId: string;
  applicationUpdatedAt: string;
  row: ArtifactRow | null;
};

type ArtifactMutation = {
  before: RegistrationKeySnapshot;
  written: ArtifactRow;
  applicationWrittenAt: string;
};

type RegistrationOutput = {
  id: string;
  createdAt: string;
  updatedAt: string;
};

function snapshotRegistrationKey(
  dbPath: string,
  applicationId: string,
  entry: ArtifactManifestEntry
): RegistrationKeySnapshot {
  const db = new Database(dbPath, { readonly: true });
  try {
    const application = db.prepare("SELECT updated_at FROM applications WHERE id = ?").get(applicationId) as
      | { updated_at: string }
      | undefined;
    if (!application) invalid("artifact_reconciliation_failed");
    const row = tableExists(db, "application_artifacts")
      ? db.prepare(`
        SELECT id, application_id, type, title, file_path, content_type, created_at, updated_at
        FROM application_artifacts WHERE application_id = ? AND type = ? AND file_path = ?
      `).get(applicationId, entry.type, entry.filePath) as ArtifactRow | undefined
      : undefined;
    return { applicationId, applicationUpdatedAt: application.updated_at, row: row ?? null };
  } finally {
    db.close();
  }
}

function ledgerCommittedRegistration(
  dbPath: string,
  entry: ArtifactManifestEntry,
  before: RegistrationKeySnapshot,
  startedAt: string,
  finishedAt: string,
  ledger: ArtifactMutation[]
): ArtifactMutation | null {
  const db = new Database(dbPath, { readonly: true });
  try {
    if (!tableExists(db, "application_artifacts")) return null;
    const written = db.prepare(`
      SELECT id, application_id, type, title, file_path, content_type, created_at, updated_at
      FROM application_artifacts WHERE application_id = ? AND type = ? AND file_path = ?
    `).get(before.applicationId, entry.type, entry.filePath) as ArtifactRow | undefined;
    const application = db.prepare("SELECT updated_at FROM applications WHERE id = ?").get(
      before.applicationId
    ) as { updated_at: string } | undefined;
    if (
      !written || !application ||
      written.title !== entry.title || written.content_type !== entry.contentType ||
      written.updated_at < startedAt || written.updated_at > finishedAt ||
      application.updated_at !== written.updated_at ||
      (before.row
        ? written.id !== before.row.id || written.created_at !== before.row.created_at
        : written.created_at < startedAt || written.created_at > finishedAt)
    ) {
      return null;
    }
    const mutation = { before, written, applicationWrittenAt: application.updated_at };
    ledger.push(mutation);
    return mutation;
  } finally {
    db.close();
  }
}

function compensateArtifactRegistrations(dbPath: string, ledger: ArtifactMutation[]) {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  try {
    db.transaction(() => {
      if (tableExists(db, "application_artifacts")) {
        const removeWritten = db.prepare(`
          DELETE FROM application_artifacts
          WHERE id = ? AND application_id = ? AND type = ? AND title = ? AND file_path = ?
            AND content_type = ? AND created_at = ? AND updated_at = ?
        `);
        const restoreWritten = db.prepare(`
          UPDATE application_artifacts
          SET application_id = ?, type = ?, title = ?, file_path = ?, content_type = ?,
              created_at = ?, updated_at = ?
          WHERE id = ? AND application_id = ? AND type = ? AND title = ? AND file_path = ?
            AND content_type = ? AND created_at = ? AND updated_at = ?
        `);
        for (const mutation of [...ledger].reverse()) {
          const written = mutation.written;
          const before = mutation.before.row;
          if (before) {
            restoreWritten.run(
              before.application_id, before.type, before.title, before.file_path,
              before.content_type, before.created_at, before.updated_at,
              written.id, written.application_id, written.type, written.title,
              written.file_path, written.content_type, written.created_at, written.updated_at
            );
          } else {
            removeWritten.run(
              written.id, written.application_id, written.type, written.title,
              written.file_path, written.content_type, written.created_at, written.updated_at
            );
          }
          db.prepare(`
            UPDATE applications SET updated_at = ?
            WHERE id = ? AND updated_at = ?
          `).run(
            mutation.before.applicationUpdatedAt,
            mutation.before.applicationId,
            mutation.applicationWrittenAt
          );
        }
      }
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
  mutation: ArtifactMutation | null
) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare(`
      SELECT id, application_id, type, title, file_path, content_type, created_at, updated_at
      FROM application_artifacts WHERE id = ?
    `).get(output.id) as ArtifactRow | undefined;
    if (
      !mutation || !row || !sameArtifactRow(row, mutation.written) ||
      row.application_id !== applicationId || row.type !== entry.type ||
      row.title !== entry.title || row.file_path !== entry.filePath || row.content_type !== entry.contentType ||
      row.id !== output.id || row.created_at !== output.createdAt || row.updated_at !== output.updatedAt
    ) invalid("artifact_registration_readback_invalid");
  } catch {
    invalid("artifact_registration_readback_invalid");
  } finally {
    db.close();
  }
}

function sameArtifactRow(left: ArtifactRow, right: ArtifactRow) {
  return left.id === right.id && left.application_id === right.application_id &&
    left.type === right.type && left.title === right.title && left.file_path === right.file_path &&
    left.content_type === right.content_type && left.created_at === right.created_at &&
    left.updated_at === right.updated_at;
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

async function yieldToEventLoop() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
