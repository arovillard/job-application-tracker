"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";

import type { AgentProviderName, AgentRunState, PublicAgentRun } from "../lib/agent-workflow/types";

type ProviderDiagnostic = {
  provider: AgentProviderName;
  available: boolean;
  version: string | null;
  defaultModel: string;
  error?: string;
};

type Props = { open: boolean; onClose(): void };

const POLLABLE = new Set(["queued_preview", "previewing", "queued_execution", "executing", "verifying"]);
const CANCELLABLE = new Set([...POLLABLE, "awaiting_approval"]);
const TERMINAL = new Set(["cancelled", "failed", "interrupted", "succeeded"]);
const SAFE_FAILURE_MESSAGES: Record<string, string> = {
  preview_unusable: "The job posting could not be identified reliably. Try another public posting URL.",
  posting_retrieval_failed: "The public job posting could not be retrieved safely. Check the link or try another public posting URL."
};
const HOST_PREVIEW_STAGES = new Set([
  "Validating public job URL.",
  "Retrieving public job posting.",
  "Analyzing job posting."
]);

function formatElapsed(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatEventTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function stageFor(run: PublicAgentRun) {
  const latest = [...run.events]
    .sort((left, right) => left.sequence - right.sequence)
    .filter((event) => HOST_PREVIEW_STAGES.has(event.message))
    .at(-1)?.message;
  if (latest) return latest;
  const stages: Partial<Record<AgentRunState, string>> = {
    queued_preview: "Validating public job URL.",
    previewing: "Analyzing job posting.",
    queued_execution: "Preparing application materials.",
    executing: "Creating application materials.",
    verifying: "Verifying application artifacts."
  };
  return stages[run.state] ?? run.state.replaceAll("_", " ");
}

function formatUsage(usage: PublicAgentRun["usage"]) {
  if (!usage) return [];
  const fields = [
    ["input_tokens", "inputTokens", "input"],
    ["output_tokens", "outputTokens", "output"],
    ["cached_input_tokens", "cachedInputTokens", "cached"]
  ] as const;
  return fields.flatMap(([snake, camel, label]) => {
    const value = usage[snake] ?? usage[camel];
    return typeof value === "number" ? [`${value.toLocaleString()} ${label}`] : [];
  });
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error ?? "The agent request could not be completed.");
  return body as T;
}

export function ApplyWithAgentDrawer({ open, onClose }: Props) {
  const [providers, setProviders] = useState<ProviderDiagnostic[] | null>(null);
  const [provider, setProvider] = useState<AgentProviderName>("codex");
  const [jobUrl, setJobUrl] = useState("");
  const [model, setModel] = useState("");
  const [run, setRun] = useState<PublicAgentRun | null>(null);
  const [pending, setPending] = useState<"start" | "approve" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsFailed, setDiagnosticsFailed] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const diagnosticsLoaded = useRef(false);
  const diagnosticsInFlight = useRef(false);
  const enteredOpenState = useRef(false);
  const openRef = useRef(open);
  const mountedRef = useRef(true);
  const epochRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const pollControllerRef = useRef<AbortController | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const terminalResetOnOpen = useRef(false);
  const elapsedRunId = useRef<string | null>(null);

  const clearPoll = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const pollController = pollControllerRef.current;
    pollControllerRef.current = null;
    if (pollController) {
      pollController.abort();
      controllers.current.delete(pollController);
    }
  }, []);

  const invalidateRequests = useCallback(() => {
    epochRef.current += 1;
    clearPoll();
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
  }, [clearPoll]);

  const resetLocalWorkflow = useCallback(() => {
    invalidateRequests();
    setRun(null);
    setJobUrl("");
    setModel("");
    setError(null);
    setPending(null);
    setElapsedSeconds(0);
    elapsedRunId.current = null;
    terminalResetOnOpen.current = false;
  }, [invalidateRequests]);

  const localFetch = useCallback(async <T,>(url: string, init: RequestInit = {}, controller = new AbortController()) => {
    controllers.current.add(controller);
    try {
      return await readResponse<T>(await fetch(url, { ...init, signal: controller.signal }));
    } finally {
      controllers.current.delete(controller);
    }
  }, []);

  const schedulePoll = useCallback(function schedule(current: PublicAgentRun, epoch = epochRef.current) {
    if (!mountedRef.current || !openRef.current || epoch !== epochRef.current || !POLLABLE.has(current.state)) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      if (!mountedRef.current || !openRef.current || epoch !== epochRef.current) return;
      const controller = new AbortController();
      pollControllerRef.current = controller;
      try {
        const next = await localFetch<PublicAgentRun>(`/api/agent-runs/${current.id}`, { cache: "no-store" }, controller);
        if (!mountedRef.current || !openRef.current || epoch !== epochRef.current || pollControllerRef.current !== controller) return;
        setError(null);
        setRun(next);
        schedule(next, epoch);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (!mountedRef.current || !openRef.current || epoch !== epochRef.current || pollControllerRef.current !== controller) return;
        setError("Agent progress is temporarily unavailable. Retrying…");
        schedule(current, epoch);
      } finally {
        if (pollControllerRef.current === controller) pollControllerRef.current = null;
      }
    }, 1000);
  }, [localFetch]);

  const loadDiagnostics = useCallback(async () => {
    if (!mountedRef.current || !openRef.current || diagnosticsInFlight.current) return;
    invalidateRequests();
    const epoch = epochRef.current;
    diagnosticsInFlight.current = true;
    setDiagnosticsLoading(true);
    setDiagnosticsFailed(false);
    setError(null);
    try {
      const result = await localFetch<{ providers: ProviderDiagnostic[] }>("/api/agent-providers", { cache: "no-store" });
      if (!mountedRef.current || !openRef.current || epoch !== epochRef.current) return;
      diagnosticsLoaded.current = true;
      setProviders(result.providers);
      const first = result.providers.find((item) => item.available);
      if (first) setProvider(first.provider);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (!mountedRef.current || !openRef.current || epoch !== epochRef.current) return;
      diagnosticsLoaded.current = false;
      setDiagnosticsFailed(true);
      setError("Provider availability could not be checked. Retry when ready.");
    } finally {
      if (mountedRef.current && epoch === epochRef.current) {
        diagnosticsInFlight.current = false;
        setDiagnosticsLoading(false);
      }
    }
  }, [invalidateRequests, localFetch]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidateRequests();
    };
  }, [invalidateRequests]);

  useEffect(() => {
    openRef.current = open;
    if (!open) {
      if (run && TERMINAL.has(run.state)) terminalResetOnOpen.current = true;
      invalidateRequests();
      diagnosticsInFlight.current = false;
      setDiagnosticsLoading(false);
      setPending(null);
      if (enteredOpenState.current) restoreFocusRef.current?.focus();
      enteredOpenState.current = false;
      return;
    }

    if (terminalResetOnOpen.current) resetLocalWorkflow();

    if (!enteredOpenState.current) {
      enteredOpenState.current = true;
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      (urlRef.current ?? dialogRef.current?.querySelector<HTMLElement>("button, a[href], input"))?.focus();
    }

    if (!diagnosticsLoaded.current && !diagnosticsInFlight.current) void loadDiagnostics();
    if (run && POLLABLE.has(run.state) && !timerRef.current && !pollControllerRef.current) schedulePoll(run);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button, a[href], input, select")]
        .filter((item) => !(item instanceof HTMLButtonElement || item instanceof HTMLInputElement || item instanceof HTMLSelectElement) || !item.disabled)
        .filter((item) => item.tabIndex >= 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [invalidateRequests, loadDiagnostics, onClose, open, resetLocalWorkflow, run, schedulePoll]);

  const activeRunId = run && POLLABLE.has(run.state) ? run.id : null;
  const runIsActive = Boolean(activeRunId);
  useEffect(() => {
    if (!open || !activeRunId) return;
    if (elapsedRunId.current !== activeRunId) {
      elapsedRunId.current = activeRunId;
      setElapsedSeconds(0);
    }
    const timer = setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [activeRunId, open]);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || !providers?.find((item) => item.provider === provider)?.available) return;
    invalidateRequests();
    const epoch = epochRef.current;
    setPending("start"); setError(null);
    const trimmedModel = model.trim();
    try {
      const created = await localFetch<PublicAgentRun>("/api/agent-runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobUrl, provider, ...(trimmedModel ? { model: trimmedModel } : {}) })
      });
      if (!mountedRef.current || !openRef.current || epoch !== epochRef.current) return;
      setRun(created); schedulePoll(created, epoch);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError") && mountedRef.current && openRef.current && epoch === epochRef.current) setError(caught instanceof Error ? caught.message : "Unable to start the agent.");
    } finally {
      if (mountedRef.current && openRef.current && epoch === epochRef.current) setPending(null);
    }
  };

  const actOnRun = async (action: "approve" | "cancel") => {
    if (!run || pending) return;
    invalidateRequests();
    const epoch = epochRef.current;
    setPending(action); setError(null);
    try {
      const next = await localFetch<PublicAgentRun>(`/api/agent-runs/${run.id}/${action}`, { method: "POST" });
      if (!mountedRef.current || !openRef.current || epoch !== epochRef.current) return;
      setRun(next);
      if (POLLABLE.has(next.state)) schedulePoll(next, epoch);
      else clearPoll();
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError") && mountedRef.current && openRef.current && epoch === epochRef.current) {
        setError(caught instanceof Error ? caught.message : `Unable to ${action} this run.`);
        if (action === "cancel" && POLLABLE.has(run.state)) schedulePoll(run, epoch);
      }
    } finally {
      if (mountedRef.current && openRef.current && epoch === epochRef.current) setPending(null);
    }
  };

  if (!open) return null;
  const chosen = providers?.find((item) => item.provider === provider);
  const unavailable = providers && !providers.some((item) => item.available);
  const closeBackdrop = (event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onClose(); };
  const currentStage = run ? stageFor(run) : "";
  const usage = formatUsage(run?.usage ?? null);
  const safeFailureMessage = run?.failureCode ? SAFE_FAILURE_MESSAGES[run.failureCode] : undefined;
  const submittedHostname = (() => {
    try { return run ? new URL(run.canonicalJobUrl).hostname : ""; } catch { return ""; }
  })();

  return (
    <div className="agent-drawer-backdrop" onMouseDown={closeBackdrop}>
      <aside ref={dialogRef} className="agent-drawer" role="dialog" aria-modal="true" aria-labelledby="agent-drawer-title">
        <header className="agent-drawer__header">
          <div><p className="panel-heading__eyebrow">Application assistant</p><h2 id="agent-drawer-title">Apply with agent</h2></div>
          <button className="agent-drawer__close" type="button" aria-label="Close Apply with agent" onClick={onClose}>×</button>
        </header>
        <div className="agent-drawer__body">
          {!run ? <form className="agent-drawer__form" onSubmit={start}>
            <label>Job posting URL<input ref={urlRef} type="url" required value={jobUrl} onChange={(event) => setJobUrl(event.target.value)} placeholder="https://…" /></label>
            <fieldset><legend>Agent provider</legend>
              {providers ? providers.map((item) => <label className="agent-provider" key={item.provider}>
                <input type="radio" name="provider" value={item.provider} checked={provider === item.provider} disabled={!item.available} onChange={() => setProvider(item.provider)} />
                <span><strong>{item.provider === "codex" ? "Codex" : "Claude"}</strong><small>{item.available ? item.version ?? "Available" : "Unavailable"} · Default {item.defaultModel}</small></span>
              </label>) : <p>{diagnosticsLoading ? "Checking provider availability…" : "Provider availability has not been checked."}</p>}
            </fieldset>
            {chosen ? <p className="agent-drawer__default">Default model: {chosen.defaultModel}</p> : null}
            <label>Model override <span>(optional)</span><input name="model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="Leave blank for default" /></label>
            {unavailable ? <p className="notice notice--error">No agent provider is available on this machine.</p> : null}
            {(diagnosticsFailed || unavailable) ? <button className="button" type="button" disabled={diagnosticsLoading} onClick={() => void loadDiagnostics()}>{diagnosticsLoading ? "Checking providers…" : "Retry provider check"}</button> : null}
            <button className="button button--primary" type="submit" disabled={Boolean(pending) || !chosen?.available}>{pending === "start" ? "Starting…" : "Start preview"}</button>
          </form> : <div className="agent-thread">
            {runIsActive ? <div className="agent-activity" role="status" aria-label="Agent work in progress">
              <span className="agent-activity__spinner" aria-hidden="true" />
              <div><strong>{currentStage}</strong><span>Working… · {formatElapsed(elapsedSeconds)}</span></div>
            </div> : null}
            <section className="agent-thread__progress" aria-live="polite" aria-label="Agent progress">
              {!runIsActive ? <p className="agent-message agent-message--status">{run.state.replaceAll("_", " ")}</p> : null}
              {[...run.events].sort((left, right) => left.sequence - right.sequence).filter((event) => event.kind !== "usage").map((event) => <p className={`agent-message agent-message--${event.kind}`} key={event.id}>
                <time className="agent-event-time" dateTime={event.createdAt}>{formatEventTime(event.createdAt)}</time>{event.message}
              </p>)}
            </section>
            {usage.length ? <p className="agent-usage" aria-label="Agent token usage">{usage.join(" · ")}</p> : null}
            {run.state === "awaiting_approval" && run.preview ? <section className="agent-preview" aria-labelledby="agent-preview-title">
              <h3 id="agent-preview-title">Review job preview</h3><dl>
                <div><dt>Company</dt><dd>{run.preview.company}</dd></div><div><dt>Role</dt><dd>{run.preview.role}</dd></div>
                {run.preview.location ? <div><dt>Location</dt><dd>{run.preview.location}</dd></div> : null}
                <div><dt>Posting</dt><dd>{run.preview.postingState}</dd></div><div><dt>Provider</dt><dd>{run.provider} · {run.model}</dd></div>
              </dl><p>{run.preview.summary}</p>
              <button className="button button--primary" type="button" disabled={Boolean(pending)} onClick={() => void actOnRun("approve")}>{pending === "approve" ? "Approving…" : "Approve and create materials"}</button>
            </section> : null}
            {run.state === "succeeded" && run.applicationId ? <section className="agent-result"><h3>Application materials ready</h3><Link href={`/applications/${run.applicationId}`}>View application</Link>{run.artifactLinks.map((artifact) => <a key={artifact.id} href={artifact.href}>{artifact.title}</a>)}</section> : null}
            {run.state === "failed" ? <div className="notice notice--error">
              <p>{safeFailureMessage ?? "The agent could not complete this application."}</p>
              {safeFailureMessage && submittedHostname ? <p>Submitted posting: {submittedHostname}</p> : null}
            </div> : null}
            {run.state === "interrupted" ? <p className="notice notice--error">The agent run was interrupted. You can start again.</p> : null}
            {run.state === "cancelled" ? <p className="notice">The agent run was cancelled.</p> : null}
            {safeFailureMessage ? <button className="button" type="button" onClick={resetLocalWorkflow}>Try another URL</button> : null}
            {TERMINAL.has(run.state) ? <button className="button button--primary" type="button" onClick={resetLocalWorkflow}>Start another application</button> : null}
            {CANCELLABLE.has(run.state) && !run.cancellationRequested ? <button className="button button--danger" type="button" disabled={Boolean(pending)} onClick={() => void actOnRun("cancel")}>{pending === "cancel" ? "Cancelling…" : "Cancel"}</button> : null}
          </div>}
          {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
        </div>
      </aside>
    </div>
  );
}
