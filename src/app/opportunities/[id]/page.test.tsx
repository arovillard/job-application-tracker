import { describe, expect, it } from "vitest";

import OpportunityDetailRoute from "./page";

describe("OpportunityDetailRoute", () => {
  it("passes a valid task target to the client page", async () => {
    const element = await OpportunityDetailRoute({
      params: Promise.resolve({ id: "opportunity-1" }),
      searchParams: Promise.resolve({ attention: "task", taskId: "task-1" })
    });
    expect(element.props).toMatchObject({
      opportunityId: "opportunity-1",
      attentionTarget: { kind: "task", taskId: "task-1" }
    });
  });

  it("passes a valid missing-next-action target to the client page", async () => {
    const element = await OpportunityDetailRoute({
      params: Promise.resolve({ id: "opportunity-1" }),
      searchParams: Promise.resolve({ attention: "missing_next_action" })
    });
    expect(element.props).toMatchObject({
      opportunityId: "opportunity-1",
      attentionTarget: { kind: "missing_next_action" }
    });
  });

  it("drops malformed and extraneous targets", async () => {
    const malformed = await OpportunityDetailRoute({
      params: Promise.resolve({ id: "opportunity-1" }),
      searchParams: Promise.resolve({ attention: "task", taskId: ["task-1"] })
    });
    const extraneous = await OpportunityDetailRoute({
      params: Promise.resolve({ id: "opportunity-1" }),
      searchParams: Promise.resolve({ attention: "missing_next_action", taskId: "task-1" })
    });
    expect(malformed.props.attentionTarget).toBeNull();
    expect(extraneous.props.attentionTarget).toBeNull();
  });
});
