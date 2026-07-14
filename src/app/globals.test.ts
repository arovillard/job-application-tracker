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
    expect(mobileCss).toMatch(/\.application-form__actions\s*\{[^}]*background:\s*var\(--surface\);[^}]*border-top:\s*1px\s+solid\s+var\(--line\);[^}]*bottom:\s*0;[^}]*position:\s*sticky;[^}]*\}/s);
    expect(mobileCss).toContain(".modal .application-form__actions { position: static; }");
  });

  it("styles the WCE-9 dashboard pulse, contextual states, and rich table rows", () => {
    for (const selector of [
      ".pipeline-pulse {",
      ".pipeline-pulse__metrics {",
      ".pipeline-pulse__metrics strong {",
      ".pipeline-pulse__bar {",
      ".pipeline-pulse__bar--empty {",
      ".pipeline-pulse__bar-jobs {",
      ".pipeline-pulse__bar-connections {",
      ".notice--error .button, .notice--error button {",
      ".application-table--empty {",
      ".application-table__link {",
      ".application-table__link:focus-visible {"
    ]) {
      expect(css).toContain(selector);
    }
  });

  it("keeps retry controls at least 44px tall", () => {
    const retryRule = css.match(/\.notice--error \.button, \.notice--error button\s*\{([^}]*)\}/)?.[1];
    const minHeight = retryRule?.match(/min-height:\s*(\d+)px/)?.[1];

    expect(retryRule).toBeDefined();
    expect(Number(minHeight)).toBeGreaterThanOrEqual(44);
  });

  it("keeps task action controls at least 44px tall", () => {
    const taskActionRule = css.match(/\.task-item__actions button\s*\{([^}]*)\}/)?.[1];
    const minHeight = taskActionRule?.match(/min-height:\s*(\d+)px/)?.[1];

    expect(taskActionRule).toBeDefined();
    expect(Number(minHeight)).toBeGreaterThanOrEqual(44);
  });

  it("gives every connection stage and activity marker a semantic or safe default", () => {
    for (const status of ["new", "outreach_planned", "waiting", "in_conversation", "opportunity_identified", "dormant", "closed", "archived"]) {
      expect(css).toContain(`.stage-select[data-status="${status}"]`);
    }

    for (const type of ["note", "message", "email", "call", "meeting", "introduction", "status_change", "task_created", "task_completed", "task_cancelled", "task_rescheduled", "opportunity_created", "linked_job_created"]) {
      expect(css).toContain(`.activity-timeline__marker--${type}`);
    }
    expect(css).toContain(".activity-timeline__marker--default");
  });

  it("cascades dashboard filters and table cards without fixed-width overflow at 760px and 320px", () => {
    const mobileStart = css.indexOf("@media (max-width: 760px)");
    const nextMediaStart = css.indexOf("@media", mobileStart + 1);
    const mobileCss = css.slice(mobileStart, nextMediaStart === -1 ? undefined : nextMediaStart);

    expect(mobileCss).toMatch(/\.pipeline-filter-rail\s*\{[^}]*overflow-x:\s*auto;[^}]*scrollbar-width:\s*none;[^}]*\}/s);
    expect(mobileCss).toMatch(/\.application-table__table, \.application-table__body, \.application-table__row, \.application-table__cell\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;[^}]*\}/s);
    expect(mobileCss).toMatch(/\.application-table__cell\s*\{[^}]*grid-template-columns:\s*minmax\(72px,\s*0\.7fr\)\s+minmax\(0,\s*1fr\);[^}]*\}/s);
    expect(css).toContain("@media (max-width: 320px)");
    expect(css).toMatch(/@media \(max-width: 320px\)\s*\{[\s\S]*?body\s*\{[^}]*min-width:\s*0;[^}]*\}/s);
  });

  it("uses theme-derived dashboard tokens and retains visible focus and motion gates", () => {
    expect(css).toMatch(/:root\[data-theme="dark"\]\s*\{[^}]*--accent-soft:[^;]+;[^}]*--success-soft:[^;]+;[^}]*--warning-soft:[^;]+;[^}]*--danger-soft:[^;]+;[^}]*\}/s);
    expect(css).toContain(".pipeline-pulse__bar--empty { background: var(--surface-strong);");
    expect(css).toContain(".status-filter__button:focus-visible");
    expect(css).toContain("@media (hover: hover) and (pointer: fine)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("uses restrained blue and amber connection accents in both themes", () => {
    const lightTokens = css.match(/:root\s*\{([^}]*)\}/)?.[1];
    const darkTokens = css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)?.[1];

    expect(lightTokens).toContain("--connection-planned: #3f6fb7;");
    expect(lightTokens).toContain("--connection-introduction: #b56a16;");
    expect(lightTokens).toContain("--connection-conversation: #168a9a;");
    expect(darkTokens).toContain("--connection-planned: #8fb5ef;");
    expect(darkTokens).toContain("--connection-introduction: #f0b66e;");
    expect(darkTokens).toContain("--connection-conversation: #66cad5;");
    expect(css).not.toMatch(/--connection-(?:planned|introduction):\s*#(?:705cc8|b5a7ff|b05c96|f3a3d5);/i);
  });

  it("compacts dashboard/detail hierarchy and gives the primary task a designed action layout", () => {
    expect(css).toMatch(/\.pipeline-title-lockup\s*\{[^}]*align-items:\s*baseline;[^}]*display:\s*flex;[^}]*\}/s);
    expect(css).toMatch(/\.detail-shell\s*\{[^}]*padding-top:\s*28px;[^}]*\}/s);
    expect(css).toMatch(/\.detail-shell \.app-header\s*\{[^}]*margin-bottom:\s*18px;[^}]*min-height:\s*0;[^}]*\}/s);
    expect(css).toMatch(/\.task-item--primary\s*\{[^}]*display:\s*grid;[^}]*gap:\s*18px;[^}]*\}/s);
    expect(css).toMatch(/\.task-item__reschedule\s*\{[^}]*border-top:\s*1px solid var\(--line\);[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;[^}]*\}/s);
    expect(css).toMatch(/\.task-item__reschedule input\s*\{[^}]*min-height:\s*44px;[^}]*\}/s);
    expect(css).toMatch(/\.detail-command\s*\{[^}]*display:\s*grid;[^}]*margin-bottom:\s*20px;[^}]*\}/s);
    expect(css).toMatch(/\.detail-command \.app-header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;[^}]*margin:\s*0;[^}]*\}/s);
    expect(css).toMatch(/\.detail-command__controls\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*row-reverse;[^}]*\}/s);
    expect(css).toMatch(/\.actions-card__other\s*\{[^}]*border-top:\s*1px solid var\(--line\);[^}]*\}/s);
    expect(css).toMatch(/\.snapshot-card \.detail-list div\s*\{[^}]*grid-template-columns:\s*minmax\(0, 0\.8fr\) minmax\(0, 1fr\);[^}]*\}/s);
    expect(css).toMatch(/\.snapshot-card__edit\s*\{[^}]*width:\s*100%;[^}]*\}/s);
  });

  it("contains modal field focus rings within scrollable form boundaries", () => {
    expect(css).toMatch(/\.modal \.application-form__body\s*\{[^}]*margin:\s*-4px;[^}]*padding:\s*4px;[^}]*scroll-padding:\s*4px;[^}]*\}/s);
    expect(css).toMatch(/\.modal \.application-form__input:focus-visible,[\s\S]*?\.modal \.application-form__textarea:focus-visible\s*\{[^}]*border-color:\s*var\(--accent\);[^}]*outline:\s*2px solid[^;]+;[^}]*outline-offset:\s*-2px;[^}]*\}/s);
  });

  it("gives the interaction composer compact metadata, narrative emphasis, and an optional follow-up surface", () => {
    expect(css).toMatch(/\.interaction-form__meta\s*\{[^}]*align-items:\s*end;[^}]*\}/s);
    expect(css).toMatch(/\.interaction-form__narrative \.application-form__textarea\s*\{[^}]*min-height:\s*150px;[^}]*\}/s);
    expect(css).toMatch(/\.interaction-form__followup\s*\{[^}]*background:\s*linear-gradient[^;]+;[^}]*border-radius:\s*14px;[^}]*padding:\s*18px;[^}]*\}/s);
    expect(css).toMatch(/\.interaction-form \.application-form__actions\s*\{[^}]*border-top:\s*1px solid var\(--line\);[^}]*\}/s);
  });

  it("applies one polished modal system with task and confirmation variants", () => {
    expect(css).toMatch(/\.modal-backdrop\s*\{[^}]*backdrop-filter:\s*blur\(6px\);[^}]*\}/s);
    expect(css).toMatch(/\.modal::before\s*\{[^}]*background:\s*linear-gradient[^;]+;[^}]*height:\s*3px;[^}]*\}/s);
    expect(css).toMatch(/\.modal__header\s*\{[^}]*background:\s*linear-gradient[^;]+;[^}]*padding:\s*20px 24px 18px;[^}]*\}/s);
    expect(css).toMatch(/\.task-composer-form__intro\s*\{[^}]*border-radius:\s*12px;[^}]*display:\s*grid;[^}]*\}/s);
    expect(css).toMatch(/\.confirmation-form__message\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\);[^}]*\}/s);
    expect(css).toContain(".confirmation-form--danger .confirmation-form__symbol");
  });

  it("styles action-first attention links and contextual arrivals with touch-safe focus", () => {
    expect(css).toMatch(/\.attention-strip__item\s*\{[^}]*min-height:\s*44px;[^}]*\}/s);
    expect(css).toMatch(/\.attention-strip__item:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--accent\);[^}]*outline:\s*none;[^}]*\}/s);
    expect(css).toMatch(/\.attention-strip__content\s*\{[^}]*display:\s*grid;[^}]*\}/s);
    expect(css).toContain(".attention-strip__meta {");
    expect(css).toContain(".attention-context {");
    expect(css).toContain(".attention-context--active {");
    expect(css).toContain(".attention-context--resolved {");
    expect(css).toMatch(/\.attention-context__actions \.button\s*\{[^}]*min-height:\s*44px;[^}]*\}/s);
    expect(css).toContain(".attention-context:focus-visible");
    expect(css).toContain(".task-item--attention");
  });

  it("stacks contextual attention content on narrow screens without adding motion", () => {
    expect(css).toMatch(/\/\* Attention context mobile \*\/\s*@media \(max-width: 760px\)\s*\{[\s\S]*?\.attention-context\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*\}[\s\S]*?\.attention-context__actions\s*\{[^}]*width:\s*100%;[^}]*\}/s);
    expect(css).not.toMatch(/\.attention-context[^}]*animation:/s);
    expect(css).not.toMatch(/\.attention-context[^}]*transition:/s);
  });
});
