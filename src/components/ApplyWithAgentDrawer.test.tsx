// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { ApplyWithAgentDrawer } from "./ApplyWithAgentDrawer";

type FetchReply = { body: unknown; ok?: boolean; status?: number };
type DrawerFetchOptions = {
  [key: string]: unknown;
  body?: string;
  method?: string;
  signal?: AbortSignal;
};
type DrawerFetch = (url: string, options: DrawerFetchOptions) => Promise<Response>;

const diagnostics = {
  providers: [
    { provider: "codex", available: true, version: "1.2.3", defaultModel: "gpt-5" },
    { provider: "claude", available: false, version: null, defaultModel: "sonnet", error: "Provider executable is unavailable." }
  ]
};
const onlineHealth = { status: "online" as const, lastSeenAt: "2026-07-10T20:00:00.000Z" };
const offlineHealth = { status: "offline" as const, lastSeenAt: null };

function run(state: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1", provider: "codex", model: "gpt-5", canonicalJobUrl: "https://jobs.example/secret",
    state, preview: null, applicationId: null, artifactLinks: [], usage: null,
    cancellationRequested: false, failureCode: null, failureMessage: null,
    createdAt: "2026-01-01", updatedAt: "2026-01-01", events: [], ...overrides
  };
}

function jsonReply({ body, ok = true, status = 200 }: FetchReply) {
  return Promise.resolve({ ok, status, json: async () => body } as Response);
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

describe("ApplyWithAgentDrawer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let replies: FetchReply[];
  let workflowFetchMock: Mock<DrawerFetch>;
  let fetchMock: Mock<DrawerFetch>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    replies = [];
    workflowFetchMock = vi.fn<DrawerFetch>(() => {
      const reply = replies.shift();
      if (!reply) throw new Error("Unexpected fetch");
      return jsonReply(reply);
    });
    fetchMock = vi.fn<DrawerFetch>((url, options = {}) => {
      if (url === "/api/agent-worker-health") return jsonReply({ body: onlineHealth });
      return workflowFetchMock(url, options);
    });
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mounted = true;
  });

  afterEach(async () => {
    if (mounted) await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  async function render(open = true, onClose = vi.fn()) {
    await act(async () => root.render(<ApplyWithAgentDrawer open={open} onClose={onClose} />));
    return onClose;
  }

  function button(name: string) {
    return [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(name)) as HTMLButtonElement;
  }

  async function input(inputElement: HTMLInputElement, value: string) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputElement, value);
      inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function submitRun(model = "") {
    await input(container.querySelector("input[type=url]")!, "https://example.com/job");
    if (model) await input(container.querySelector("input[name=model]")!, model);
    await act(async () => button("Start preview").click());
  }

  function installWorkerScenario({
    health = [onlineHealth],
    created = run("queued_preview"),
    polled = created
  }: {
    health?: Array<typeof onlineHealth | typeof offlineHealth>;
    created?: ReturnType<typeof run>;
    polled?: ReturnType<typeof run>;
  } = {}) {
    let healthIndex = 0;
    fetchMock.mockImplementation((url, options = {}) => {
      if (url === "/api/agent-providers") return jsonReply({ body: diagnostics });
      if (url === "/api/agent-worker-health") {
        const body = health[Math.min(healthIndex, health.length - 1)];
        healthIndex += 1;
        return jsonReply({ body });
      }
      if (url === "/api/agent-runs" && options.method === "POST") {
        return jsonReply({ body: created, status: 202 });
      }
      if (url === `/api/agent-runs/${created.id}`) return jsonReply({ body: polled });
      throw new Error(`Unexpected test URL: ${url}`);
    });
  }

  it("disables new previews and explains how to start an offline worker", async () => {
    installWorkerScenario({ health: [offlineHealth] });
    await render();
    await act(async () => {});
    expect(container.textContent).toContain("Agent worker is offline. Start JobTracker with npm run dev.");
    expect(button("Start preview").disabled).toBe(true);
  });

  it.each([
    ["queued_preview", "Waiting for agent worker", "Queue time"],
    ["queued_execution", "Waiting for agent worker", "Queue time"]
  ])("renders online %s as queued rather than active work", async (state, stage, timerLabel) => {
    installWorkerScenario({ created: run(state) });
    await render(); await act(async () => {}); await submitRun();
    expect(container.textContent).toContain(stage);
    expect(container.textContent).toContain(timerLabel);
    expect(container.textContent).not.toContain("Validating public job URL");
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Agent run queued");
  });

  it("shows offline reconnect status for an existing queued run", async () => {
    installWorkerScenario({ health: [onlineHealth, offlineHealth] });
    await render(); await act(async () => {}); await submitRun();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.textContent).toContain("Agent worker is offline");
    expect(container.textContent).toContain("Waiting to reconnect");
    expect(button("Cancel")).toBeTruthy();
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Agent run queued");
  });

  it("shows validation only after the worker owns previewing", async () => {
    const previewing = run("previewing", {
      events: [{
        id: "event-validation", runId: "run-1", sequence: 2, kind: "status",
        message: "Validating public job URL.", metadata: null,
        createdAt: "2026-07-10T20:00:01.000Z"
      }]
    });
    installWorkerScenario({ created: previewing });
    await render(); await act(async () => {}); await submitRun();
    expect(container.textContent).toContain("Validating public job URL.");
    expect(container.textContent).toContain("Working…");
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Agent work in progress");
  });

  it("shows connection loss without rewriting an active run", async () => {
    installWorkerScenario({ health: [onlineHealth, offlineHealth], created: run("previewing") });
    await render(); await act(async () => {}); await submitRun();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.textContent).toContain("Agent worker connection lost");
    expect(container.textContent).not.toContain("interrupted");
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Agent worker connection lost");
  });

  it.each(["resolve", "reject"])("keeps one exact health poll chain after a stale request %ss", async (settlement) => {
    const staleHealth = deferred<Response>();
    let healthCalls = 0;
    fetchMock.mockImplementation((url) => {
      if (url === "/api/agent-providers") return jsonReply({ body: diagnostics });
      if (url === "/api/agent-worker-health") {
        healthCalls += 1;
        return healthCalls === 1 ? staleHealth.promise : jsonReply({ body: onlineHealth });
      }
      throw new Error(`Unexpected test URL: ${url}`);
    });

    await render(); await act(async () => {});
    expect(healthCalls).toBe(1);
    await render(false);
    await render(true); await act(async () => {});
    expect(healthCalls).toBe(2);
    if (settlement === "resolve") {
      await act(async () => staleHealth.resolve(await jsonReply({ body: onlineHealth })));
    } else {
      await act(async () => staleHealth.reject(new DOMException("Aborted", "AbortError")));
    }

    await act(async () => vi.advanceTimersByTimeAsync(4_999));
    expect(healthCalls).toBe(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(healthCalls).toBe(3);
    await act(async () => vi.advanceTimersByTimeAsync(4_999));
    expect(healthCalls).toBe(3);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(healthCalls).toBe(4);
  });

  it("requires fresh health after close before enabling preview on reopen", async () => {
    const reopenedHealth = deferred<Response>();
    let healthCalls = 0;
    fetchMock.mockImplementation((url) => {
      if (url === "/api/agent-providers") return jsonReply({ body: diagnostics });
      if (url === "/api/agent-worker-health") {
        healthCalls += 1;
        return healthCalls === 1 ? jsonReply({ body: onlineHealth }) : reopenedHealth.promise;
      }
      throw new Error(`Unexpected test URL: ${url}`);
    });

    await render(); await act(async () => {});
    expect(button("Start preview").disabled).toBe(false);
    await render(false);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(healthCalls).toBe(1);
    await render(true); await act(async () => {});
    expect(healthCalls).toBe(2);
    expect(button("Start preview").disabled).toBe(true);
    expect(container.textContent).not.toContain("Agent worker is offline.");
    await act(async () => reopenedHealth.resolve(await jsonReply({ body: offlineHealth })));
    expect(button("Start preview").disabled).toBe(true);
    expect(container.textContent).toContain("Agent worker is offline. Start JobTracker with npm run dev.");
  });

  it("enables previews after worker health changes from offline to online", async () => {
    installWorkerScenario({ health: [offlineHealth, onlineHealth] });
    await render(); await act(async () => {});
    expect(button("Start preview").disabled).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(4_999));
    expect(button("Start preview").disabled).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(button("Start preview").disabled).toBe(false);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/agent-worker-health")).toHaveLength(2);
  });

  it.each(["close", "unmount"])("aborts and clears worker health polling on %s", async (action) => {
    let healthCalls = 0;
    let healthSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((url, options = {}) => {
      if (url === "/api/agent-providers") return jsonReply({ body: diagnostics });
      if (url === "/api/agent-worker-health") {
        healthCalls += 1;
        if (healthCalls === 1) return jsonReply({ body: onlineHealth });
        healthSignal = options.signal;
        return new Promise(() => {});
      }
      throw new Error(`Unexpected test URL: ${url}`);
    });
    await render(); await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(healthSignal?.aborted).toBe(false);
    if (action === "close") await render(false);
    else {
      await act(async () => root.unmount());
      mounted = false;
    }
    expect(healthSignal?.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(healthCalls).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("loads diagnostics on first open and exposes provider defaults and one required URL", async () => {
    replies.push({ body: diagnostics });
    await render();
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledWith("/api/agent-providers", expect.objectContaining({ cache: "no-store" }));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelectorAll("input[type=url]")).toHaveLength(1);
    expect((container.querySelector("input[type=url]") as HTMLInputElement).required).toBe(true);
    expect(container.textContent).toContain("Codex");
    expect(container.textContent).toContain("1.2.3");
    expect(container.textContent).toContain("Default model: gpt-5");
    expect((container.querySelector('input[value="claude"]') as HTMLInputElement).disabled).toBe(true);
    expect(document.activeElement).toBe(container.querySelector("input[type=url]"));
  });

  it("shows active stage, activity status, elapsed time, event timestamps, and formatted usage", async () => {
    const active = run("previewing", {
      usage: { input_tokens: 208992, output_tokens: 1241, cached_input_tokens: 150784 },
      events: [{
        id: "e1", runId: "run-1", sequence: 1, kind: "status",
        message: "Retrieving public job posting.", metadata: { path: "/private" },
        createdAt: "2026-01-01T12:34:56Z"
      }, {
        id: "e2", runId: "run-1", sequence: 2, kind: "progress",
        message: "Provider processing details.", metadata: null,
        createdAt: "2026-01-01T12:34:57Z"
      }, {
        id: "e3", runId: "run-1", sequence: 3, kind: "usage",
        message: "Provider usage update.", metadata: null,
        createdAt: "2026-01-01T12:34:58Z"
      }]
    });
    workflowFetchMock.mockImplementation((url) => jsonReply({ body: url === "/api/agent-providers" ? diagnostics : active }));
    await render(); await act(async () => {}); await submitRun();

    expect(container.querySelector('[aria-label="Agent work in progress"]')).not.toBeNull();
    expect(container.textContent).toContain("Retrieving public job posting.");
    expect(container.textContent).toContain("Working… · 0:00");
    expect(container.textContent).toContain("208,992 input");
    expect(container.textContent).toContain("1,241 output");
    expect(container.textContent).toContain("150,784 cached");
    expect(container.textContent).not.toContain("Provider usage update.");
    expect(container.textContent).not.toContain("/private");
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe("2026-01-01T12:34:56Z");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(container.textContent).toContain("Working… · 0:01");
    await act(async () => vi.advanceTimersByTimeAsync(64_000));
    expect(container.textContent).toContain("Working… · 1:05");
  });

  it.each([
    ["executing", "Creating application materials."],
    ["verifying", "Verifying application artifacts."]
  ])("uses the %s state label even when preview stage events remain in history", async (state, expectedStage) => {
    const active = run(state, {
      events: [{
        id: "e1", runId: "run-1", sequence: 1, kind: "status",
        message: "Analyzing job posting.", metadata: null, createdAt: "2026-01-01T12:34:56Z"
      }]
    });
    workflowFetchMock.mockImplementation((url) => jsonReply({ body: url === "/api/agent-providers" ? diagnostics : active }));
    await render(); await act(async () => {}); await submitRun();
    expect(container.querySelector(".agent-activity strong")?.textContent).toBe(expectedStage);
  });

  it.each([
    ["preview_unusable", "The job posting could not be identified reliably. Try another public posting URL."],
    ["posting_retrieval_failed", "The public job posting could not be retrieved safely. Check the link or try another public posting URL."]
  ])("shows safe %s recovery without approval", async (failureCode, failureMessage) => {
    replies.push({ body: diagnostics }, { body: run("failed", { failureCode, failureMessage }), status: 202 });
    await render(); await act(async () => {}); await submitRun();
    expect(container.textContent).toContain(failureMessage);
    expect(button("Try another URL")).toBeTruthy();
    expect(button("Approve and create materials")).toBeFalsy();
  });

  it.each(["cancelled", "failed", "interrupted", "succeeded"])("offers restart for terminal %s", async (state) => {
    replies.push({ body: diagnostics }, { body: run(state), status: 202 });
    await render(); await act(async () => {}); await submitRun();
    expect(button("Start another application")).toBeTruthy();
  });

  it.each(["cancelled", "failed", "interrupted", "succeeded"])("resets terminal %s after close and reopen", async (state) => {
    replies.push({ body: diagnostics }, { body: run(state), status: 202 });
    await render(); await act(async () => {}); await submitRun("custom-model");
    await render(false);
    await render(true);
    expect(container.querySelectorAll("input[type=url]")).toHaveLength(1);
    expect((container.querySelector("input[type=url]") as HTMLInputElement).value).toBe("");
    expect((container.querySelector("input[name=model]") as HTMLInputElement).value).toBe("");
    expect(container.querySelector(".agent-thread__progress")).toBeNull();
  });

  it.each(["previewing", "awaiting_approval"])("preserves %s after close and reopen", async (state) => {
    const overrides = state === "awaiting_approval"
      ? { preview: { company: "Acme", role: "Engineer", location: null, summary: "Fit", postingState: "open" } }
      : {};
    replies.push({ body: diagnostics }, { body: run(state, overrides), status: 202 });
    await render(); await act(async () => {}); await submitRun();
    await render(false);
    await render(true);
    expect(container.textContent).toMatch(state === "previewing" ? /previewing|job posting/i : /Review job preview/);
    expect(container.querySelector("input[type=url]")).toBeNull();
  });

  it("starts another application with local-only reset and clears timers", async () => {
    replies.push({ body: diagnostics }, { body: run("cancelled"), status: 202 });
    await render(); await act(async () => {}); await submitRun("custom-model");
    await act(async () => button("Start another application").click());
    expect(workflowFetchMock.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(false);
    expect((container.querySelector("input[type=url]") as HTMLInputElement).value).toBe("");
    expect((container.querySelector("input[name=model]") as HTMLInputElement).value).toBe("");
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(workflowFetchMock).toHaveBeenCalledTimes(2);
  });

  it("posts only the strict local payload and omits a blank model override", async () => {
    replies.push({ body: diagnostics }, { body: run("queued_preview"), status: 202 });
    await render(); await act(async () => {}); await act(async () => vi.advanceTimersByTimeAsync(0)); await submitRun();
    const [url, options] = workflowFetchMock.mock.calls[1];
    expect(url).toBe("/api/agent-runs");
    expect(JSON.parse(options.body!)).toEqual({ jobUrl: "https://example.com/job", provider: "codex" });
    expect(fetchMock.mock.calls.every(([calledUrl]) => String(calledUrl).startsWith("/api/agent-"))).toBe(true);
  });

  it("has no client import path to providers, orchestrator, workers, or model SDKs", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/ApplyWithAgentDrawer.tsx"), "utf8");
    expect(source).not.toMatch(/agent-workflow\/(providers|orchestrator)|@anthropic-ai|openai(?!-)/);
    expect(source).not.toMatch(/from\s+["'][^"']*agent-worker/);
  });

  it("includes a nonblank model override and prevents double submission", async () => {
    let resolvePost!: (value: Response) => void;
    replies.push({ body: diagnostics });
    workflowFetchMock.mockImplementationOnce(() => jsonReply(replies.shift()!)).mockImplementationOnce(() => new Promise((resolve) => { resolvePost = resolve; }));
    await render(); await act(async () => {}); await submitRun("custom-model");
    button("Starting").click();
    expect(workflowFetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(workflowFetchMock.mock.calls[1][1].body!)).toEqual({ jobUrl: "https://example.com/job", provider: "codex", model: "custom-model" });
    await act(async () => resolvePost(await jsonReply({ body: run("queued_preview"), status: 202 })));
  });

  it("polls pollable states in one timer chain and renders only sanitized event messages", async () => {
    replies.push(
      { body: diagnostics }, { body: run("queued_preview"), status: 202 },
      { body: run("previewing", { events: [{ id: "e1", runId: "run-1", sequence: 1, kind: "progress", message: "Reading posting", metadata: { path: "/secret", raw: "no" }, createdAt: "now" }] }) },
      { body: run("awaiting_approval", { preview: { company: "Acme", role: "Engineer", location: null, summary: "Good fit", postingState: "open" } }) }
    );
    await render(); await act(async () => {}); await submitRun();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("Reading posting");
    expect(container.textContent).not.toContain("/secret");
    expect(container.textContent).not.toContain("jobs.example");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(container.textContent).toContain("Acme");
    expect(container.textContent).toContain("Engineer");
    expect(container.textContent).toContain("Good fit");
    expect(button("Approve and create materials")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(workflowFetchMock).toHaveBeenCalledTimes(4);
  });

  it("retries a transient poll failure after one second without overlapping", async () => {
    replies.push(
      { body: diagnostics }, { body: run("previewing"), status: 202 },
      { body: { error: "temporary" }, ok: false, status: 503 }, { body: run("cancelled") }
    );
    await render(); await act(async () => {}); await submitRun();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(container.textContent).toContain("Agent progress is temporarily unavailable. Retrying");
    expect(container.textContent).not.toContain("temporary");
    expect(workflowFetchMock).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(workflowFetchMock).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(workflowFetchMock).toHaveBeenCalledTimes(4);
    expect(container.textContent).toMatch(/cancelled/i);
  });

  it("resumes polling only after explicit approval and stops at success with server links", async () => {
    replies.push(
      { body: diagnostics }, { body: run("awaiting_approval", { preview: { company: "Acme", role: "Engineer", location: "Remote", summary: "Fit", postingState: "open" } }), status: 202 },
      { body: run("queued_execution") },
      { body: run("succeeded", { applicationId: "app-1", artifactLinks: [{ id: "a1", type: "resume", title: "Tailored resume", href: "/api/applications/app-1/artifacts/a1" }] }) }
    );
    await render(); await act(async () => {}); await submitRun();
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(workflowFetchMock).toHaveBeenCalledTimes(2);
    await act(async () => button("Approve and create materials").click());
    expect(workflowFetchMock.mock.calls[2][0]).toBe("/api/agent-runs/run-1/approve");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(container.querySelector('a[href="/applications/app-1"]')).not.toBeNull();
    expect(container.querySelector('a[href="/api/applications/app-1/artifacts/a1"]')?.textContent).toContain("Tailored resume");
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(workflowFetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(["failed", "interrupted", "cancelled"])("stops at %s and shows a safe message", async (state) => {
    replies.push({ body: diagnostics }, { body: run(state, { failureMessage: "/private/raw stderr" }), status: 202 });
    await render(); await act(async () => {}); await submitRun();
    expect(container.textContent).toMatch(state === "failed" ? /could not complete/i : state === "interrupted" ? /interrupted/i : /cancelled/i);
    expect(container.textContent).not.toContain("/private/raw stderr");
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(workflowFetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels active or approval work and stops when cancelled", async () => {
    replies.push({ body: diagnostics }, { body: run("previewing"), status: 202 }, { body: run("cancelled") });
    await render(); await act(async () => {}); await submitRun();
    await act(async () => button("Cancel").click());
    expect(workflowFetchMock.mock.calls[2][0]).toBe("/api/agent-runs/run-1/cancel");
    expect(container.textContent).toMatch(/cancelled/i);
  });

  it("ignores a stale in-flight poll that resolves after cancellation", async () => {
    const stalePoll = deferred<Response>();
    let staleSignal: AbortSignal | undefined;
    workflowFetchMock
      .mockImplementationOnce(() => jsonReply({ body: diagnostics }))
      .mockImplementationOnce(() => jsonReply({ body: run("previewing"), status: 202 }))
      .mockImplementationOnce((_url, options) => { staleSignal = options.signal; return stalePoll.promise; })
      .mockImplementationOnce(() => jsonReply({ body: run("cancelled") }));
    await render(); await act(async () => {}); await submitRun();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    await act(async () => button("Cancel").click());
    expect(staleSignal?.aborted).toBe(true);
    await act(async () => stalePoll.resolve(await jsonReply({ body: run("previewing") })));
    expect(container.textContent).toMatch(/cancelled/i);
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(workflowFetchMock).toHaveBeenCalledTimes(4);
  });

  it("starts exactly one fresh poll chain when cancellation fails for an active run", async () => {
    const stalePoll = deferred<Response>();
    let staleSignal: AbortSignal | undefined;
    workflowFetchMock
      .mockImplementationOnce(() => jsonReply({ body: diagnostics }))
      .mockImplementationOnce(() => jsonReply({ body: run("executing"), status: 202 }))
      .mockImplementationOnce((_url, options) => { staleSignal = options.signal; return stalePoll.promise; })
      .mockImplementationOnce(() => jsonReply({ body: { error: "Cancellation is temporarily unavailable." }, ok: false, status: 503 }))
      .mockImplementationOnce(() => jsonReply({ body: run("cancelled") }));
    await render(); await act(async () => {}); await submitRun();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    await act(async () => button("Cancel").click());
    expect(staleSignal?.aborted).toBe(true);
    await act(async () => stalePoll.resolve(await jsonReply({ body: run("awaiting_approval") })));
    expect(container.textContent).toContain("Creating application materials.");
    expect(container.textContent).not.toContain("awaiting approval");
    expect(container.textContent).toContain("Cancellation is temporarily unavailable.");
    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(workflowFetchMock).toHaveBeenCalledTimes(4);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(workflowFetchMock).toHaveBeenCalledTimes(5);
    expect(container.textContent).toMatch(/cancelled/i);
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(workflowFetchMock).toHaveBeenCalledTimes(5);
  });

  it("does not poll after cancellation fails while awaiting approval", async () => {
    replies.push(
      { body: diagnostics },
      { body: run("awaiting_approval", { preview: { company: "Acme", role: "Engineer", location: null, summary: "Fit", postingState: "open" } }), status: 202 },
      { body: { error: "Cancellation is temporarily unavailable." }, ok: false, status: 503 }
    );
    await render(); await act(async () => {}); await submitRun();
    await act(async () => button("Cancel").click());
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(workflowFetchMock).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("awaiting approval");
  });

  it("ignores an older action completion after the drawer is closed", async () => {
    const pendingCancel = deferred<Response>();
    let actionSignal: AbortSignal | undefined;
    workflowFetchMock
      .mockImplementationOnce(() => jsonReply({ body: diagnostics }))
      .mockImplementationOnce(() => jsonReply({ body: run("previewing"), status: 202 }))
      .mockImplementationOnce((_url, options) => { actionSignal = options.signal; return pendingCancel.promise; });
    await render(); await act(async () => {}); await submitRun();
    await act(async () => button("Cancel").click());
    await render(false);
    expect(actionSignal?.aborted).toBe(true);
    await act(async () => pendingCancel.reject(new DOMException("Aborted", "AbortError")));
    await render(true);
    expect(container.textContent).toContain("Analyzing job posting.");
    expect(container.textContent).not.toContain("Unable to cancel");
  });

  it("keeps polling after a cancellation request until cancellation is confirmed", async () => {
    replies.push(
      { body: diagnostics }, { body: run("executing"), status: 202 },
      { body: run("executing", { cancellationRequested: true }) }, { body: run("cancelled") }
    );
    await render(); await act(async () => {}); await submitRun();
    await act(async () => button("Cancel").click());
    expect(button("Cancel")).toBeFalsy();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(container.textContent).toMatch(/cancelled/i);
  });

  it.each(["queued_preview", "previewing", "queued_execution", "executing", "verifying"])("polls while %s", async (state) => {
    replies.push({ body: diagnostics }, { body: run(state), status: 202 }, { body: run("cancelled") });
    await render(); await act(async () => {}); await submitRun();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(workflowFetchMock.mock.calls[2][0]).toBe("/api/agent-runs/run-1");
  });

  it("clears polling and aborts an in-flight request when closed", async () => {
    let pollSignal: AbortSignal | undefined;
    replies.push({ body: diagnostics }, { body: run("previewing"), status: 202 });
    workflowFetchMock.mockImplementationOnce(() => jsonReply(replies.shift()!))
      .mockImplementationOnce(() => jsonReply(replies.shift()!))
      .mockImplementationOnce((_url, options) => {
        pollSignal = options.signal;
        return new Promise(() => {});
      });
    await render(); await act(async () => {}); await submitRun();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(pollSignal?.aborted).toBe(false);
    await render(false);
    expect(pollSignal?.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(workflowFetchMock).toHaveBeenCalledTimes(3);
  });

  it("clears a scheduled poll timer when closed before it fires", async () => {
    replies.push({ body: diagnostics }, { body: run("previewing"), status: 202 });
    await render(); await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(vi.getTimerCount()).toBe(1);
    await submitRun();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await render(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts an in-flight request on unmount", async () => {
    let signal: AbortSignal | undefined;
    workflowFetchMock.mockImplementationOnce((_url, options) => {
      signal = options.signal;
      return new Promise(() => {});
    });
    await render();
    expect(signal?.aborted).toBe(false);
    await act(async () => root.unmount());
    mounted = false;
    expect(signal?.aborted).toBe(true);
  });

  it("ignores an abort-rejecting pending poll after unmount without a warning or retry", async () => {
    const pendingPoll = deferred<Response>();
    let pollSignal: AbortSignal | undefined;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    workflowFetchMock
      .mockImplementationOnce(() => jsonReply({ body: diagnostics }))
      .mockImplementationOnce(() => jsonReply({ body: run("previewing"), status: 202 }))
      .mockImplementationOnce((_url, options) => {
        pollSignal = options.signal;
        options.signal!.addEventListener("abort", () => pendingPoll.reject(new DOMException("Aborted", "AbortError")), { once: true });
        return pendingPoll.promise;
      });
    await render(); await act(async () => {}); await act(async () => vi.advanceTimersByTimeAsync(0)); await submitRun();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    await act(async () => root.unmount());
    mounted = false;
    expect(pollSignal?.aborted).toBe(true);
    await act(async () => {});
    expect(workflowFetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("ignores an abort-rejecting pending approval after unmount without a late update", async () => {
    const pendingApproval = deferred<Response>();
    let approvalSignal: AbortSignal | undefined;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    workflowFetchMock
      .mockImplementationOnce(() => jsonReply({ body: diagnostics }))
      .mockImplementationOnce(() => jsonReply({ body: run("awaiting_approval", { preview: { company: "Acme", role: "Engineer", location: null, summary: "Fit", postingState: "open" } }), status: 202 }))
      .mockImplementationOnce((_url, options) => {
        approvalSignal = options.signal;
        options.signal!.addEventListener("abort", () => pendingApproval.reject(new DOMException("Aborted", "AbortError")), { once: true });
        return pendingApproval.promise;
      });
    await render(); await act(async () => {}); await act(async () => vi.advanceTimersByTimeAsync(0)); await submitRun();
    await act(async () => button("Approve and create materials").click());
    await act(async () => root.unmount());
    mounted = false;
    expect(approvalSignal?.aborted).toBe(true);
    await act(async () => {});
    expect(workflowFetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("closes via Escape and backdrop, restores focus, and aborts in-flight work", async () => {
    replies.push({ body: diagnostics });
    const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
    const onClose = await render(true); await act(async () => {});
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLElement>(".agent-drawer-backdrop")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(2);
    await render(false, onClose);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("wraps focus with Tab and Shift+Tab", async () => {
    replies.push({ body: diagnostics });
    await render(); await act(async () => {});
    const close = container.querySelector<HTMLButtonElement>(".agent-drawer__close")!;
    const last = button("Start preview");
    close.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
    last.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(close);
  });

  it("recovers diagnostics from an HTTP failure with a non-overlapping retry", async () => {
    replies.push(
      { body: { error: "diagnostic failure" }, ok: false, status: 503 },
      { body: diagnostics }
    );
    await render(); await act(async () => {});
    expect(container.textContent).toContain("Provider availability could not be checked");
    await act(async () => button("Retry provider check").click());
    expect(workflowFetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Default model: gpt-5");
  });

  it("retries failed diagnostics after close and reopen", async () => {
    workflowFetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("offline"))).mockImplementationOnce(() => jsonReply({ body: diagnostics }));
    await render(); await act(async () => {});
    await render(false);
    await render(true); await act(async () => {});
    expect(workflowFetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Codex");
  });

  it("shows an unavailable notice and disables submission when every provider is unavailable", async () => {
    replies.push({ body: { providers: diagnostics.providers.map((item) => ({ ...item, available: false, version: null })) } });
    await render(); await act(async () => {});
    expect(container.textContent).toContain("No agent provider is available on this machine");
    expect([...container.querySelectorAll<HTMLInputElement>('input[name="provider"]')].every((item) => item.disabled)).toBe(true);
    expect(button("Start preview").disabled).toBe(true);
    expect(button("Retry provider check")).toBeTruthy();
  });
});
