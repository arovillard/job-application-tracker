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
  recoverAbandonedAgentRuns,
  renewAgentRunLease,
  transitionAgentRun
} from "./storage";
import type {
  AgentPreview,
  AgentProviderName,
  AgentRun,
  AgentRunState,
  ArtifactManifestEntry
} from "./types";

const UPSERT_AUDIT_NOTE = "Approved JobTracker agent preview; host-controlled upsert.";
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
    const transitioned = transitionAgentRun(run.id, "previewing", "awaiting_approval", {
      preview: result.preview,
      usage: result.usage
    });
    if (!transitioned) throw new PhaseStoppedError(resolveStop(run.id));
    appendAgentRunEvent(run.id, { kind: "status", message: "Preview ready for approval." });
  } catch (error) {
    finishActiveFailure(run.id, "previewing", error, "preview_failed", "Preview failed.");
  }
}

async function processExecution(run: AgentRun, deps: AgentOrchestratorDependencies) {
  appendAgentRunEvent(run.id, { kind: "status", message: "Execution started." });
  try {
    if (!run.preview) throw new SafeWorkflowError("approved_preview_missing", "Approved preview is missing.");
    const upsert = await activePhase(run.id, deps, (signal) =>
      runJsonCommand(
        process.execPath,
        [path.join(deps.projectRoot, "scripts", "upsert-job-posting.mjs"), "--input-json", "-", "--reactivate"],
        upsertPayload(run.preview!, run.canonicalJobUrl),
        commandOptions(deps, signal)
      )
    );
    const applicationId = validateUpsert(upsert, run.preview, run.canonicalJobUrl);
    verifyUpsertReadback(deps.dbPath, applicationId, run.preview, run.canonicalJobUrl, upsert);

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
    const verifying = transitionAgentRun(run.id, "executing", "verifying", {
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
    for (const entry of manifest) {
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
      const artifactId = validateRegistration(registered, applicationId, entry);
      verifyRegistrationReadback(deps.dbPath, artifactId, applicationId, entry);
      links.push({
        id: artifactId,
        type: entry.type,
        title: entry.title,
        href: `/api/applications/${applicationId}/artifacts/${artifactId}/file`
      });
    }
    const completed = transitionAgentRun(run.id, "verifying", "succeeded", {
      artifactManifest: manifest,
      artifactLinks: links
    });
    if (!completed) throw new PhaseStoppedError(resolveStop(run.id));
    appendAgentRunEvent(run.id, { kind: "status", message: "Application materials completed." });
  } catch (error) {
    const current = getAgentRun(run.id);
    const state = current?.state === "verifying" ? "verifying" : "executing";
    const code = error instanceof SafeWorkflowError ? error.code : state === "verifying"
      ? "artifact_reconciliation_failed"
      : "execution_failed";
    finishActiveFailure(run.id, state, error, code, state === "verifying" ? "Artifact reconciliation failed." : "Execution failed.");
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
  expectedState: "previewing" | "executing" | "verifying",
  error: unknown,
  failureCode: string,
  failureMessage: string
) {
  const stop = error instanceof PhaseStoppedError ? error.reason : null;
  const nextState: AgentRunState = stop === "cancelled" ? "cancelled" : stop === "lost_lease" ? "interrupted" : "failed";
  transitionAgentRun(runId, expectedState, nextState, nextState === "failed" ? { failureCode, failureMessage } : {});
  appendAgentRunEvent(runId, {
    kind: nextState === "failed" ? "error" : "status",
    message: nextState === "cancelled" ? "Run cancelled." : nextState === "interrupted" ? "Run interrupted." : failureMessage
  });
}

function resolveStop(runId: string): PhaseStop {
  return getAgentRun(runId)?.cancellationRequested ? "cancelled" : "lost_lease";
}

function upsertPayload(preview: AgentPreview, canonicalJobUrl: string) {
  return {
    company: preview.company,
    role: preview.role,
    url: canonicalJobUrl,
    source: new URL(canonicalJobUrl).hostname.toLowerCase().replace(/^www\./, ""),
    location: preview.location,
    summary: preview.summary,
    posting_state: preview.postingState,
    note: UPSERT_AUDIT_NOTE
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

function verifyUpsertReadback(dbPath: string, id: string, preview: AgentPreview, url: string, output: unknown) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const application = db.prepare("SELECT id, company, role, status, url FROM applications WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!application || application.company !== preview.company || application.role !== preview.role || application.url !== url || ["archived", "rejected"].includes(String(application.status))) invalid("upsert_readback_invalid");
    const noteIds = record(output, "upsert_readback_invalid").noteIds as string[];
    for (const noteId of noteIds) {
      const note = db.prepare("SELECT application_id, body FROM application_notes WHERE id = ?").get(noteId) as { application_id: string; body: string } | undefined;
      if (!note || note.application_id !== id || !note.body.includes(UPSERT_AUDIT_NOTE)) invalid("upsert_readback_invalid");
    }
  } catch {
    invalid("upsert_readback_invalid");
  } finally {
    db.close();
  }
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

function validateRegistration(value: unknown, applicationId: string, entry: ArtifactManifestEntry): string {
  const output = record(value, "artifact_registration_invalid");
  const artifact = record(output.artifact, "artifact_registration_invalid");
  if (
    output.action !== "registered" ||
    typeof artifact.id !== "string" || !artifact.id ||
    artifact.applicationId !== applicationId || artifact.type !== entry.type ||
    artifact.title !== entry.title || artifact.filePath !== entry.filePath || artifact.contentType !== entry.contentType
  ) invalid("artifact_registration_invalid");
  return artifact.id as string;
}

function verifyRegistrationReadback(dbPath: string, id: string, applicationId: string, entry: ArtifactManifestEntry) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare("SELECT id, application_id, type, title, file_path, content_type FROM application_artifacts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row || row.application_id !== applicationId || row.type !== entry.type || row.title !== entry.title || row.file_path !== entry.filePath || row.content_type !== entry.contentType) invalid("artifact_registration_readback_invalid");
  } catch {
    invalid("artifact_registration_readback_invalid");
  } finally {
    db.close();
  }
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
