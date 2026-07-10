import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AGENT_RUN_STATES,
  type AgentPreview,
  type AgentRunState
} from "./types";
import {
  appendAgentRunEvent,
  approveAgentRun,
  claimNextExecution,
  claimNextPreview,
  createAgentRun,
  getAgentRun,
  getPublicAgentRun,
  recoverAbandonedAgentRuns,
  requestAgentRunCancellation,
  resetAgentRunStorageForTests,
  transitionAgentRun
} from "./storage";

let tempDir: string;

const preview: AgentPreview = {
  company: "Acme",
  role: "Platform Engineer",
  location: "Remote",
  summary: "Build reliable developer infrastructure.",
  postingState: "open"
};

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-agent-runs-"));
  process.env.JOBTRACKER_DB_PATH = path.join(tempDir, "test.sqlite");
});

afterEach(() => {
  resetAgentRunStorageForTests();
  delete process.env.JOBTRACKER_DB_PATH;
  rmSync(tempDir, { force: true, recursive: true });
});

function createQueuedRun(suffix = "one") {
  return createAgentRun({
    provider: "codex",
    model: "gpt-5.6-terra",
    canonicalJobUrl: `https://example.com/jobs/${suffix}`
  });
}

describe("agent run domain", () => {
  it("defines the ten run states exactly", () => {
    expect(AGENT_RUN_STATES).toEqual([
      "queued_preview",
      "previewing",
      "awaiting_approval",
      "queued_execution",
      "executing",
      "verifying",
      "succeeded",
      "failed",
      "cancelled",
      "interrupted"
    ]);
  });

  it("applies every legal compare-and-set edge", () => {
    const paths: AgentRunState[][] = [
      ["queued_preview", "previewing", "awaiting_approval", "queued_execution", "executing", "verifying", "succeeded"],
      ["queued_preview", "previewing", "failed"],
      ["queued_preview", "cancelled"],
      ["queued_preview", "previewing", "cancelled"],
      ["queued_preview", "previewing", "interrupted"],
      ["queued_preview", "previewing", "awaiting_approval", "cancelled"],
      ["queued_preview", "previewing", "awaiting_approval", "queued_execution", "cancelled"],
      ["queued_preview", "previewing", "awaiting_approval", "queued_execution", "executing", "cancelled"],
      ["queued_preview", "previewing", "awaiting_approval", "queued_execution", "executing", "failed"],
      ["queued_preview", "previewing", "awaiting_approval", "queued_execution", "executing", "interrupted"],
      ["queued_preview", "previewing", "awaiting_approval", "queued_execution", "executing", "verifying", "failed"],
      ["queued_preview", "previewing", "awaiting_approval", "queued_execution", "executing", "verifying", "cancelled"],
      ["queued_preview", "previewing", "awaiting_approval", "queued_execution", "executing", "verifying", "interrupted"]
    ];

    for (const [index, states] of paths.entries()) {
      const run = createQueuedRun(`legal-${index}`);
      for (let stateIndex = 1; stateIndex < states.length; stateIndex += 1) {
        const previous = states[stateIndex - 1];
        const next = states[stateIndex];
        expect(transitionAgentRun(run.id, previous, next)?.state).toBe(next);
      }
    }
  });

  it("rejects illegal and stale transitions without mutation", () => {
    const run = createQueuedRun("illegal");

    expect(transitionAgentRun(run.id, "queued_preview", "succeeded")).toBeNull();
    expect(getAgentRun(run.id)?.state).toBe("queued_preview");

    expect(transitionAgentRun(run.id, "queued_preview", "previewing")?.state).toBe("previewing");
    const updatedAt = getAgentRun(run.id)?.updatedAt;
    expect(transitionAgentRun(run.id, "queued_preview", "cancelled")).toBeNull();
    expect(getAgentRun(run.id)).toMatchObject({ state: "previewing", updatedAt });
  });

  it("approves only awaiting runs and rejects duplicate approval", () => {
    const run = createQueuedRun("approve");
    expect(approveAgentRun(run.id)).toBeNull();

    transitionAgentRun(run.id, "queued_preview", "previewing");
    transitionAgentRun(run.id, "previewing", "awaiting_approval", { preview });

    expect(approveAgentRun(run.id)?.state).toBe("queued_execution");
    expect(approveAgentRun(run.id)).toBeNull();
    expect(getAgentRun(run.id)?.state).toBe("queued_execution");
  });

  it.each(["queued_preview", "awaiting_approval", "queued_execution"] as const)(
    "cancels %s immediately",
    (state) => {
      const run = createQueuedRun(`cancel-${state}`);
      if (state !== "queued_preview") {
        transitionAgentRun(run.id, "queued_preview", "previewing");
        transitionAgentRun(run.id, "previewing", "awaiting_approval", { preview });
      }
      if (state === "queued_execution") {
        approveAgentRun(run.id);
      }

      expect(requestAgentRunCancellation(run.id)).toMatchObject({
        state: "cancelled",
        cancellationRequested: true
      });
    }
  );

  it.each(["previewing", "executing", "verifying"] as const)(
    "marks active %s work for cooperative cancellation",
    (state) => {
      const run = createQueuedRun(`active-${state}`);
      transitionAgentRun(run.id, "queued_preview", "previewing");
      if (state !== "previewing") {
        transitionAgentRun(run.id, "previewing", "awaiting_approval", { preview });
        approveAgentRun(run.id);
        transitionAgentRun(run.id, "queued_execution", "executing");
      }
      if (state === "verifying") {
        transitionAgentRun(run.id, "executing", "verifying");
      }

      expect(requestAgentRunCancellation(run.id)).toMatchObject({
        state,
        cancellationRequested: true
      });
    }
  );

  it("assigns monotonic event sequences per run", () => {
    const run = createQueuedRun("events");
    const other = createQueuedRun("other-events");

    expect(appendAgentRunEvent(run.id, { kind: "status", message: "Queued" }).sequence).toBe(1);
    expect(appendAgentRunEvent(run.id, { kind: "progress", message: "Reading posting" }).sequence).toBe(2);
    expect(appendAgentRunEvent(other.id, { kind: "status", message: "Queued" }).sequence).toBe(1);
  });

  it("persists validated preview data and serializes a public view without lease internals", () => {
    const run = createQueuedRun("public");
    claimNextPreview("preview-worker", 60_000);
    transitionAgentRun(run.id, "previewing", "awaiting_approval", {
      preview,
      usage: { inputTokens: 120, outputTokens: 35 }
    });
    appendAgentRunEvent(run.id, {
      kind: "progress",
      message: "Preview ready",
      metadata: { phase: "preview" }
    });

    resetAgentRunStorageForTests();

    expect(getAgentRun(run.id)).toMatchObject({ preview, workerId: null, leaseExpiresAt: null });
    expect(getPublicAgentRun(run.id)).toEqual(
      expect.objectContaining({
        id: run.id,
        provider: "codex",
        model: "gpt-5.6-terra",
        canonicalJobUrl: "https://example.com/jobs/public",
        state: "awaiting_approval",
        preview,
        usage: { inputTokens: 120, outputTokens: 35 },
        cancellationRequested: false,
        events: [expect.objectContaining({ sequence: 1, kind: "progress", message: "Preview ready" })]
      })
    );
    expect(getPublicAgentRun(run.id)).not.toHaveProperty("workerId");
    expect(getPublicAgentRun(run.id)).not.toHaveProperty("leaseExpiresAt");
  });
});

describe("agent run leases and recovery", () => {
  it("atomically lets only one worker claim a queued preview", () => {
    const run = createQueuedRun("preview-lease");

    expect(claimNextPreview("worker-a", 60_000)).toMatchObject({
      id: run.id,
      state: "previewing",
      workerId: "worker-a"
    });
    expect(claimNextPreview("worker-b", 60_000)).toBeNull();
  });

  it("allows only one active global mutating execution lease", () => {
    const first = createQueuedRun("execution-one");
    const second = createQueuedRun("execution-two");
    for (const run of [first, second]) {
      transitionAgentRun(run.id, "queued_preview", "previewing");
      transitionAgentRun(run.id, "previewing", "awaiting_approval", { preview });
      approveAgentRun(run.id);
    }

    expect(claimNextExecution("worker-a", 60_000)).toMatchObject({
      id: first.id,
      state: "executing",
      workerId: "worker-a"
    });
    expect(claimNextExecution("worker-b", 60_000)).toBeNull();
  });

  it("recovers foreign and expired active work but leaves queued and approval work unchanged", () => {
    const foreign = createQueuedRun("foreign");
    claimNextPreview("old-worker", 60_000);

    const expired = createQueuedRun("expired");
    claimNextPreview("current-worker", -1);

    const queuedPreview = createQueuedRun("queued");
    const awaitingApproval = createQueuedRun("approval");
    transitionAgentRun(awaitingApproval.id, "queued_preview", "previewing");
    transitionAgentRun(awaitingApproval.id, "previewing", "awaiting_approval", { preview });
    const queuedExecution = createQueuedRun("queued-execution");
    transitionAgentRun(queuedExecution.id, "queued_preview", "previewing");
    transitionAgentRun(queuedExecution.id, "previewing", "awaiting_approval", { preview });
    approveAgentRun(queuedExecution.id);

    expect(recoverAbandonedAgentRuns("current-worker")).toBe(2);
    expect(getAgentRun(foreign.id)?.state).toBe("interrupted");
    expect(getAgentRun(expired.id)?.state).toBe("interrupted");
    expect(getAgentRun(queuedPreview.id)?.state).toBe("queued_preview");
    expect(getAgentRun(awaitingApproval.id)?.state).toBe("awaiting_approval");
    expect(getAgentRun(queuedExecution.id)?.state).toBe("queued_execution");
  });

  it("never requeues interrupted rows", () => {
    const run = createQueuedRun("interrupted");
    claimNextPreview("old-worker", -1);
    recoverAbandonedAgentRuns("new-worker");

    expect(claimNextPreview("new-worker", 60_000)).toBeNull();
    expect(claimNextExecution("new-worker", 60_000)).toBeNull();
    expect(getAgentRun(run.id)?.state).toBe("interrupted");
  });
});
