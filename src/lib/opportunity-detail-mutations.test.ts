import { describe, expect, it, vi } from "vitest";

import { deleteOpportunityRequest } from "./opportunity-detail-mutations";

describe("deleteOpportunityRequest", () => {
  it("redirects after a successful delete without reading its non-detail response", async () => {
    const json = vi.fn();
    const request = vi.fn().mockResolvedValue({ ok: true, status: 200, json } as unknown as Response);
    const redirect = vi.fn();

    await deleteOpportunityRequest(request, "/api/opportunities/opportunity-1", redirect);

    expect(request).toHaveBeenCalledWith("/api/opportunities/opportunity-1", { method: "DELETE" });
    expect(json).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("does not redirect when deletion fails", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Delete failed" }), { status: 500 }));
    const redirect = vi.fn();

    await expect(deleteOpportunityRequest(request, "/api/opportunities/opportunity-1", redirect)).rejects.toThrow("Delete failed");
    expect(redirect).not.toHaveBeenCalled();
  });
});
