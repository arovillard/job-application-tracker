import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AttentionQueue } from "./AttentionQueue";

describe("AttentionQueue", () => {
  it("does not render a panel when there is no attention work", () => {
    const markup = renderToStaticMarkup(
      <AttentionQueue items={[]} onViewAll={() => undefined} />
    );

    expect(markup).toBe("");
  });

  it("names the loading state", () => {
    const markup = renderToStaticMarkup(
      <AttentionQueue items={[]} loading onViewAll={() => undefined} />
    );

    expect(markup).toContain('aria-label="Loading attention queue"');
  });
});
