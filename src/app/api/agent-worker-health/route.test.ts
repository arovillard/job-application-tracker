import { describe, expect, it, vi } from "vitest";

import { createWorkerHealthHandler } from "./route";

describe("GET /api/agent-worker-health", () => {
  it("returns the exact online payload without caching", async () => {
    const readHealth = vi.fn(() => ({
      status: "online" as const,
      lastSeenAt: "2026-07-10T20:00:00.000Z"
    }));
    const response = await createWorkerHealthHandler({ readHealth })(new Request("http://localhost/api/agent-worker-health"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "online", lastSeenAt: "2026-07-10T20:00:00.000Z" });
  });

  it("collapses storage errors to the safe offline payload", async () => {
    const response = await createWorkerHealthHandler({
      readHealth: () => { throw new Error("private database path"); }
    })(new Request("http://localhost/api/agent-worker-health"));
    expect(await response.json()).toEqual({ status: "offline", lastSeenAt: null });
  });
});
