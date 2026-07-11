import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AGENT_RUN_STATES,
  type AgentPreview,
  type AgentRunState
} from "./types";
import {
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_OFFLINE_AFTER_MS,
  appendAgentRunEvent,
  approveAgentRun,
  approveAgentRunAndGetPublic,
  claimNextExecution,
  claimNextPreview,
  createAgentRun,
  enqueueAgentRun,
  getAgentWorkerHealth,
  getAgentRun,
  getPublicAgentRun,
  heartbeatAgentWorker,
  interruptOwnedAgentRun,
  recoverAbandonedAgentRuns,
  renewAgentRunLease,
  registerAgentWorker,
  requestAgentRunCancellation,
  requestAgentRunCancellationAndGetPublic,
  resetAgentRunStorageForTests,
  transitionAgentRun,
  transitionOwnedAgentRun,
  unregisterAgentWorker
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

function finishPreview(runId: string, workerId = `preview-${runId}`) {
  claimNextPreview(workerId, 60_000);
  return transitionOwnedAgentRun(runId, workerId, "previewing", "awaiting_approval", { preview });
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

  it("applies every legal state edge through its authorized operation", () => {
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
      const workerId = `legal-worker-${index}`;
      for (let stateIndex = 1; stateIndex < states.length; stateIndex += 1) {
        const previous = states[stateIndex - 1];
        const next = states[stateIndex];
        let transitioned;
        if (previous === "queued_preview") {
          transitioned = next === "previewing"
            ? claimNextPreview(workerId, 60_000)
            : requestAgentRunCancellation(run.id);
        } else if (previous === "previewing") {
          if (next === "cancelled") requestAgentRunCancellation(run.id);
          if (next === "interrupted") {
            interruptOwnedAgentRun(run.id, workerId);
            transitioned = getAgentRun(run.id);
          } else {
            transitioned = transitionOwnedAgentRun(
              run.id,
              workerId,
              "previewing",
              next,
              next === "awaiting_approval" ? { preview } : {}
            );
          }
        } else if (previous === "awaiting_approval") {
          transitioned = next === "queued_execution"
            ? approveAgentRun(run.id)
            : requestAgentRunCancellation(run.id);
        } else if (previous === "queued_execution") {
          transitioned = next === "executing"
            ? claimNextExecution(workerId, 60_000)
            : requestAgentRunCancellation(run.id);
        } else {
          if (next === "cancelled") requestAgentRunCancellation(run.id);
          if (next === "interrupted") {
            interruptOwnedAgentRun(run.id, workerId);
            transitioned = getAgentRun(run.id);
          } else {
            transitioned = transitionOwnedAgentRun(
              run.id,
              workerId,
              previous as "executing" | "verifying",
              next
            );
          }
        }
        expect(transitioned).toMatchObject({ id: run.id, state: next });
      }
    }
  });

  it("rejects illegal and stale transitions without mutation", () => {
    const run = createQueuedRun("illegal");

    expect(transitionAgentRun(run.id, "queued_preview", "succeeded")).toBeNull();
    expect(getAgentRun(run.id)?.state).toBe("queued_preview");

    expect(transitionAgentRun(run.id, "queued_preview", "previewing")).toBeNull();
    expect(claimNextPreview("illegal-owner", 60_000)?.state).toBe("previewing");
    const updatedAt = getAgentRun(run.id)?.updatedAt;
    expect(transitionAgentRun(run.id, "queued_preview", "cancelled")).toBeNull();
    expect(getAgentRun(run.id)).toMatchObject({ state: "previewing", updatedAt });
  });

  it("approves only awaiting runs and rejects duplicate approval", () => {
    const run = createQueuedRun("approve");
    expect(approveAgentRun(run.id)).toBeNull();

    finishPreview(run.id);

    expect(approveAgentRun(run.id)?.state).toBe("queued_execution");
    expect(approveAgentRun(run.id)).toBeNull();
    expect(getAgentRun(run.id)?.state).toBe("queued_execution");
  });

  it("returns the approval public snapshot from the same CAS transaction", () => {
    const run = createQueuedRun("approve-public");
    finishPreview(run.id);

    const approved = approveAgentRunAndGetPublic(run.id);
    requestAgentRunCancellationAndGetPublic(run.id);

    expect(approved?.state).toBe("queued_execution");
    expect(approveAgentRunAndGetPublic(run.id)).toBeNull();
    expect(getPublicAgentRun(run.id)?.state).toBe("cancelled");
  });

  it.each(["queued_preview", "awaiting_approval", "queued_execution"] as const)(
    "cancels %s immediately",
    (state) => {
      const run = createQueuedRun(`cancel-${state}`);
      if (state !== "queued_preview") {
        finishPreview(run.id);
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

  it("makes cancellation and approval mutually exclusive through storage CAS helpers", () => {
    const run = createQueuedRun("cancel-first-public");
    finishPreview(run.id);

    expect(requestAgentRunCancellationAndGetPublic(run.id)?.state).toBe("cancelled");
    expect(approveAgentRunAndGetPublic(run.id)).toBeNull();
    expect(requestAgentRunCancellationAndGetPublic(run.id)).toBeNull();
  });

  it.each(["previewing", "executing", "verifying"] as const)(
    "marks active %s work for cooperative cancellation",
    (state) => {
      const run = createQueuedRun(`active-${state}`);
      const workerId = `active-worker-${state}`;
      claimNextPreview(workerId, 60_000);
      if (state !== "previewing") {
        transitionOwnedAgentRun(run.id, workerId, "previewing", "awaiting_approval", { preview });
        approveAgentRun(run.id);
        claimNextExecution(workerId, 60_000);
      }
      if (state === "verifying") {
        transitionOwnedAgentRun(run.id, workerId, "executing", "verifying");
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

  it("atomically enqueues the run and fixed initial public event", () => {
    const run = enqueueAgentRun({
      provider: "codex",
      model: "gpt-5.6-terra",
      canonicalJobUrl: "https://example.com/atomic-enqueue"
    });

    expect(run).toMatchObject({ state: "queued_preview" });
    expect(run.events).toEqual([
      expect.objectContaining({ sequence: 1, kind: "status", message: "Run queued for preview." })
    ]);
  });

  it("rolls back the queued row when the fixed initial event insert fails", () => {
    getPublicAgentRun("initialize-schema");
    const db = new Database(process.env.JOBTRACKER_DB_PATH!);
    db.exec(`
      CREATE TRIGGER reject_initial_agent_event
      BEFORE INSERT ON agent_run_events
      BEGIN
        SELECT RAISE(ABORT, 'event rejected');
      END;
    `);

    expect(() => enqueueAgentRun({
      provider: "codex",
      model: "gpt-5.6-terra",
      canonicalJobUrl: "https://example.com/rollback-enqueue"
    })).toThrow();
    expect((db.prepare("SELECT COUNT(*) AS count FROM agent_runs").get() as { count: number }).count).toBe(0);
    db.close();
  });

  it("persists validated preview data and serializes a public view without lease internals", () => {
    const run = createQueuedRun("public");
    claimNextPreview("preview-worker", 60_000);
    transitionOwnedAgentRun(run.id, "preview-worker", "previewing", "awaiting_approval", {
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
  it("renews an owned preview lease and rejects a mismatched owner", () => {
    const run = createQueuedRun("renew-preview");
    const claimed = claimNextPreview("preview-owner", 1_000);

    expect(renewAgentRunLease(run.id, "other-worker", 60_000)).toBe(false);
    expect(renewAgentRunLease(run.id, "preview-owner", 60_000)).toBe(true);
    expect(new Date(getAgentRun(run.id)!.leaseExpiresAt!).getTime()).toBeGreaterThan(
      new Date(claimed!.leaseExpiresAt!).getTime()
    );
  });

  it("atomically renews an owned execution run and its exact global lease", () => {
    const run = createQueuedRun("renew-execution");
    finishPreview(run.id);
    approveAgentRun(run.id);
    const claimed = claimNextExecution("execution-owner", 1_000);

    expect(renewAgentRunLease(run.id, "other-worker", 60_000)).toBe(false);
    expect(renewAgentRunLease(run.id, "execution-owner", 60_000)).toBe(true);
    expect(new Date(getAgentRun(run.id)!.leaseExpiresAt!).getTime()).toBeGreaterThan(
      new Date(claimed!.leaseExpiresAt!).getTime()
    );
    expect(claimNextExecution("competing-worker", 60_000)).toBeNull();
  });

  it("fails closed when the execution row and global lease no longer match exactly", () => {
    const run = createQueuedRun("renew-mismatch");
    finishPreview(run.id);
    approveAgentRun(run.id);
    claimNextExecution("execution-owner", 60_000);
    const originalExpiry = getAgentRun(run.id)!.leaseExpiresAt;
    const db = new Database(process.env.JOBTRACKER_DB_PATH!);
    db.prepare("UPDATE agent_worker_leases SET expires_at = ? WHERE run_id = ?").run(
      new Date(Date.now() + 120_000).toISOString(),
      run.id
    );
    db.close();

    expect(renewAgentRunLease(run.id, "execution-owner", 60_000)).toBe(false);
    expect(getAgentRun(run.id)?.leaseExpiresAt).toBe(originalExpiry);
  });

  it("prevents an expired preview owner from publishing a late completion", () => {
    const run = createQueuedRun("late-preview");
    claimNextPreview("late-owner", -1);

    expect(
      transitionOwnedAgentRun(run.id, "late-owner", "previewing", "awaiting_approval", { preview })
    ).toBeNull();
    expect(getAgentRun(run.id)?.state).toBe("previewing");
    expect(interruptOwnedAgentRun(run.id, "late-owner")).toBe(true);
    expect(getAgentRun(run.id)?.state).toBe("interrupted");
  });

  it("prevents a stale execution owner from completing after the exact lease is replaced", () => {
    const run = createQueuedRun("late-execution");
    finishPreview(run.id);
    approveAgentRun(run.id);
    claimNextExecution("stale-owner", 60_000);
    const db = new Database(process.env.JOBTRACKER_DB_PATH!);
    db.prepare("UPDATE agent_worker_leases SET worker_id = 'replacement-owner'").run();
    db.close();

    expect(
      transitionOwnedAgentRun(run.id, "stale-owner", "executing", "verifying")
    ).toBeNull();
    expect(interruptOwnedAgentRun(run.id, "stale-owner")).toBe(false);
    expect(getAgentRun(run.id)?.state).toBe("executing");
  });

  function queueExecution(suffix: string) {
    const run = createQueuedRun(suffix);
    finishPreview(run.id);
    approveAgentRun(run.id);
    return run;
  }

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
    const first = queueExecution("execution-one");
    queueExecution("execution-two");

    expect(claimNextExecution("worker-a", 60_000)).toMatchObject({
      id: first.id,
      state: "executing",
      workerId: "worker-a"
    });
    expect(claimNextExecution("worker-b", 60_000)).toBeNull();
  });

  it("does not allow the generic transition API to bypass the execution lease", () => {
    const run = queueExecution("execution-bypass");

    expect(transitionAgentRun(run.id, "queued_execution", "executing")).toBeNull();
    expect(getAgentRun(run.id)?.state).toBe("queued_execution");
    expect(claimNextExecution("lease-owner", 60_000)).toMatchObject({
      id: run.id,
      state: "executing",
      workerId: "lease-owner"
    });
  });

  it("does not allow the generic transition API to bypass active owner fencing", () => {
    const run = createQueuedRun("active-bypass");
    expect(transitionAgentRun(run.id, "queued_preview", "previewing")).toBeNull();
    claimNextPreview("lease-owner", 60_000);

    expect(
      transitionAgentRun(run.id, "previewing", "awaiting_approval", { preview })
    ).toBeNull();
    expect(getAgentRun(run.id)).toMatchObject({ state: "previewing", workerId: "lease-owner" });
  });

  it.each(["executing", "verifying"] as const)(
    "interrupts an expired %s lease before safely claiming the next execution",
    (state) => {
      const abandoned = queueExecution(`expired-${state}`);
      claimNextExecution("expired-owner", 60_000);
      if (state === "verifying") {
        transitionOwnedAgentRun(abandoned.id, "expired-owner", "executing", "verifying");
      }
      const db = new Database(process.env.JOBTRACKER_DB_PATH!);
      const expiredAt = new Date(Date.now() - 1).toISOString();
      db.prepare("UPDATE agent_runs SET lease_expires_at = ? WHERE id = ?").run(expiredAt, abandoned.id);
      db.prepare("UPDATE agent_worker_leases SET expires_at = ? WHERE run_id = ?").run(expiredAt, abandoned.id);
      db.close();
      const next = queueExecution(`after-expired-${state}`);

      expect(claimNextExecution("replacement-owner", 60_000)).toMatchObject({
        id: next.id,
        state: "executing",
        workerId: "replacement-owner"
      });
      expect(getAgentRun(abandoned.id)).toMatchObject({
        state: "interrupted",
        workerId: null,
        leaseExpiresAt: null
      });
    }
  );

  it.each(["executing", "verifying"] as const)(
    "recovery interrupts foreign %s work, cleans its lease, and permits a later claim",
    (state) => {
      const abandoned = queueExecution(`foreign-${state}`);
      claimNextExecution("foreign-owner", 60_000);
      if (state === "verifying") {
        transitionOwnedAgentRun(abandoned.id, "foreign-owner", "executing", "verifying");
      }
      const next = queueExecution(`after-foreign-${state}`);

      expect(claimNextExecution("current-owner", 60_000)).toBeNull();
      expect(recoverAbandonedAgentRuns("current-owner")).toBe(1);
      expect(getAgentRun(abandoned.id)).toMatchObject({
        state: "interrupted",
        workerId: null,
        leaseExpiresAt: null
      });
      expect(claimNextExecution("current-owner", 60_000)).toMatchObject({
        id: next.id,
        state: "executing",
        workerId: "current-owner"
      });
    }
  );

  it("releases the execution lease when execution reaches a terminal state", () => {
    const completed = queueExecution("completed-execution");
    claimNextExecution("worker-a", 60_000);
    transitionOwnedAgentRun(completed.id, "worker-a", "executing", "verifying");
    transitionOwnedAgentRun(completed.id, "worker-a", "verifying", "succeeded");
    const next = queueExecution("after-completion");

    expect(claimNextExecution("worker-b", 60_000)).toMatchObject({
      id: next.id,
      state: "executing",
      workerId: "worker-b"
    });
  });

  it("recovers foreign and expired active work but leaves queued and approval work unchanged", () => {
    const foreign = createQueuedRun("foreign");
    claimNextPreview("old-worker", 60_000);

    const expired = createQueuedRun("expired");
    claimNextPreview("current-worker", -1);

    const awaitingApproval = createQueuedRun("approval");
    finishPreview(awaitingApproval.id);
    const queuedExecution = createQueuedRun("queued-execution");
    finishPreview(queuedExecution.id);
    approveAgentRun(queuedExecution.id);
    const queuedPreview = createQueuedRun("queued");

    expect(recoverAbandonedAgentRuns("current-worker")).toBe(2);
    expect(getAgentRun(foreign.id)?.state).toBe("interrupted");
    expect(getAgentRun(expired.id)?.state).toBe("interrupted");
    expect(getAgentRun(queuedPreview.id)?.state).toBe("queued_preview");
    expect(getAgentRun(awaitingApproval.id)?.state).toBe("awaiting_approval");
    expect(getAgentRun(queuedExecution.id)?.state).toBe("queued_execution");
  });

  it("recovers a legacy active row that has no owner", () => {
    const run = createQueuedRun("ownerless");
    const db = new Database(process.env.JOBTRACKER_DB_PATH!);
    db.prepare("UPDATE agent_runs SET state = 'previewing' WHERE id = ?").run(run.id);
    db.close();

    expect(recoverAbandonedAgentRuns("current-worker")).toBe(1);
    expect(getAgentRun(run.id)).toMatchObject({ state: "interrupted", workerId: null, leaseExpiresAt: null });
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

describe("agent worker health", () => {
  it("uses the exact heartbeat and offline thresholds", () => {
    expect(WORKER_HEARTBEAT_INTERVAL_MS).toBe(5_000);
    expect(WORKER_OFFLINE_AFTER_MS).toBe(15_000);
  });

  it("is online through the threshold and offline immediately after it", () => {
    const started = new Date("2026-07-10T20:00:00.000Z");
    registerAgentWorker("worker-a", started);
    expect(getAgentWorkerHealth(new Date(started.getTime() + 15_000))).toEqual({
      status: "online",
      lastSeenAt: started.toISOString()
    });
    expect(getAgentWorkerHealth(new Date(started.getTime() + 15_001))).toEqual({
      status: "offline",
      lastSeenAt: null
    });
  });

  it("returns the newest worker and unregisters only its owner", () => {
    registerAgentWorker("worker-a", new Date("2026-07-10T20:00:00.000Z"));
    registerAgentWorker("worker-b", new Date("2026-07-10T20:00:04.000Z"));
    heartbeatAgentWorker("worker-a", new Date("2026-07-10T20:00:08.000Z"));
    expect(getAgentWorkerHealth(new Date("2026-07-10T20:00:10.000Z"))).toEqual({
      status: "online",
      lastSeenAt: "2026-07-10T20:00:08.000Z"
    });
    unregisterAgentWorker("worker-a");
    expect(getAgentWorkerHealth(new Date("2026-07-10T20:00:10.000Z"))).toEqual({
      status: "online",
      lastSeenAt: "2026-07-10T20:00:04.000Z"
    });
  });

  it("does not change run leases while cleaning stale health rows", () => {
    const run = createQueuedRun("health-isolation");
    expect(claimNextPreview("lease-owner", 60_000)?.id).toBe(run.id);
    registerAgentWorker("stale-health", new Date("2026-07-10T19:00:00.000Z"));
    expect(getAgentWorkerHealth(new Date("2026-07-10T20:00:00.000Z"))).toEqual({
      status: "offline",
      lastSeenAt: null
    });
    expect(getAgentRun(run.id)).toMatchObject({ state: "previewing", workerId: "lease-owner" });
  });
});
