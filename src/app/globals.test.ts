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

  it("keeps task lists in a vertical layout inside next-action cards", () => {
    expect(css).not.toContain(".next-action-card > div");
    expect(css).toContain(".next-action-card > .task-list");
  });

  it("keeps the dashboard control hierarchy and table geometry aligned with main", () => {
    for (const contract of [
      "grid-template-columns: minmax(220px, 1fr) auto",
      "padding: 22px 24px 18px",
      "min-width: 770px",
      "padding: 16px 18px",
      ".application-table__cell[data-label=\"Updated\"]",
      ".application-table__loading-row"
    ]) {
      expect(css).toContain(contract);
    }

    expect(css).toMatch(/\.application-table__loading-row\s*\{[^}]*grid-template-columns:\s*1\.3fr\s+0\.7fr\s+1fr\s+0\.5fr[^}]*\}/s);
  });

  it("keeps the mobile pipeline filter rail horizontally scrollable without wrapping its filters", () => {
    const mobileStart = css.indexOf("@media (max-width: 760px)");
    const nextMediaStart = css.indexOf("@media", mobileStart + 1);
    const mobileCss = css.slice(mobileStart, nextMediaStart === -1 ? undefined : nextMediaStart);

    expect(mobileStart).toBeGreaterThanOrEqual(0);
    expect(mobileCss).toMatch(/\.pipeline-filter-rail\s*\{[^}]*overflow-x:\s*auto;[^}]*overscroll-behavior-x:\s*contain;[^}]*\}/s);
    expect(mobileCss).toMatch(/\.pipeline-filter-rail \.opportunity-type-filter, \.pipeline-filter-rail \.status-filter\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*\}/s);
  });

  it("limits transform feedback to fine hover pointers and preserves reduced motion", () => {
    expect(css).toContain("@media (hover: hover) and (pointer: fine)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toContain("transition: all");
    expect(css).not.toMatch(/transform:\s*scale\(0\)/);

    const finePointerBlock = css.match(/@media \(hover: hover\) and \(pointer: fine\)\s*\{([\s\S]*?)\n\}/)?.[1];
    expect(finePointerBlock).toBeDefined();

    for (const selector of [
      ".icon-button:hover",
      ".button:hover, .application-form__button:hover, .application-table__button:hover",
      ".application-table__open:hover span",
      ".button:active, .application-form__button:active, .application-table__button:active"
    ]) {
      expect(finePointerBlock).toContain(selector);
    }

    const cssWithoutFinePointerTransforms = css.replace(/@media \(hover: hover\) and \(pointer: fine\)\s*\{[\s\S]*?\n\}/, "");
    expect(cssWithoutFinePointerTransforms).not.toMatch(/:[^,{]*(?:hover|active)[^{]*\{[^}]*transform:/s);
  });
});
