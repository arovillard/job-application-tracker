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

  it("keeps modal form headers, bodies, and footers in independently-sized regions", () => {
    expect(css).toMatch(/\.modal\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\);[^}]*overflow:\s*hidden;[^}]*\}/s);
    expect(css).toMatch(/\.modal__header\s*\{[^}]*flex:\s*0\s+0\s+auto;[^}]*\}/s);
    expect(css).toMatch(/\.modal\s*>\s*\.application-form\s*\{[^}]*min-height:\s*0;[^}]*\}/s);
    expect(css).toMatch(/\.modal\s+\.application-form__body\s*\{[^}]*overflow-y:\s*auto;[^}]*\}/s);
    expect(css).toMatch(/\.modal\s+\.application-form__actions\s*\{[^}]*flex:\s*0\s+0\s+auto;[^}]*\}/s);
  });

  it("derives modal and mobile-footer colors from the active theme tokens", () => {
    expect(css).toMatch(/:root\[data-theme="dark"\]\s*\{[^}]*--surface:[^;]+;[^}]*--line:[^;]+;[^}]*\}/s);
    expect(css).toMatch(/\.modal\s*\{[^}]*background:\s*var\(--surface\);[^}]*border:\s*1px\s+solid\s+var\(--line\);[^}]*\}/s);
    expect(css).toMatch(/\.application-form__actions\s*\{[^}]*background:\s*var\(--surface\);[^}]*border-top:\s*1px\s+solid\s+var\(--line\);[^}]*\}/s);
  });

  it("aligns the creation form, detail workspace, menus, and dialogs with the WCE-8 visual baseline", () => {
    for (const contract of [
      ".app-shell--narrow { max-width: 1080px; }",
      ".application-form { display: grid;",
      ".application-form__planning { background: color-mix(in srgb, var(--accent-soft) 58%, var(--surface));",
      ".form-disclosure summary { align-items: center;",
      ".detail-grid { align-items: start; display: grid; gap: 24px; grid-template-columns: minmax(0, 2fr) minmax(280px, 0.72fr); }",
      ".next-action-card { background: linear-gradient(145deg, color-mix(in srgb, var(--accent-soft) 78%, var(--surface)) 0%, var(--surface) 100%);",
      ".detail-actions-menu { position: relative; }",
      ".detail-actions-menu [role=\"menu\"] {",
      ".modal--compact { max-width: 560px; }",
      ".modal--wide { max-width: 960px; }",
      ".form-disclosure[open] > :not(summary) {"
    ]) {
      expect(css).toContain(contract);
    }

    const mobileStart = css.indexOf("@media (max-width: 760px)");
    const nextMediaStart = css.indexOf("@media", mobileStart + 1);
    const mobileCss = css.slice(mobileStart, nextMediaStart === -1 ? undefined : nextMediaStart);

    expect(mobileCss).toMatch(/\.modal\s*\{[^}]*max-height:\s*calc\(100dvh\s*-\s*16px\);[^}]*width:\s*100%;[^}]*\}/s);
    expect(mobileCss).toMatch(/\.application-form__actions\s*\{[^}]*background:\s*var\(--surface\);[^}]*border-top:\s*1px\s+solid\s+var\(--line\);[^}]*position:\s*static;[^}]*\}/s);
  });
});
