import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("opportunity interface stylesheet", () => {
  it("uses active tokens and removes the obsolete chooser", () => {
    expect(css).not.toContain("var(--border)");
    expect(css).not.toContain("var(--text-muted)");
    expect(css).not.toContain(".opportunity-type-chooser");
  });

  it("provides the menu, detail, and form styling hooks", () => {
    for (const selector of [
      ".new-opportunity-menu",
      ".new-opportunity-menu__content",
      ".detail-main, .detail-side",
      ".tracker-panel__header",
      ".application-form__actions"
    ]) {
      expect(css).toContain(selector);
    }
  });

  it("retains the tablet and mobile opportunity breakpoints", () => {
    expect(css).toContain("@media (max-width: 1050px)");
    expect(css).toContain("@media (max-width: 760px)");
  });
});
