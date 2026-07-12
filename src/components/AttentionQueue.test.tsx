// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { AttentionQueue } from "./AttentionQueue";

describe("AttentionQueue", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not render a panel when there is no attention work", () => {
    const markup = renderToStaticMarkup(
      <AttentionQueue items={[]} onViewAll={() => undefined} />
    );

    expect(markup).toBe("");
  });

  it("exposes the loading state as a named status region", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <AttentionQueue items={[]} loading onViewAll={() => undefined} />
    );

    const loadingStatus = document.querySelector('[role="status"]');
    expect(loadingStatus?.textContent).toContain("Loading attention queue");
    expect(loadingStatus?.getAttribute("aria-busy")).toBe("true");
  });
});
