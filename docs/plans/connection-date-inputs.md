# Connection Date Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent invalid connection activity and task dates by rendering native date controls and locking their semantics with a rendered-DOM regression test.

**Architecture:** Extend the connection form's local input renderer with a narrow explicit HTML input type, then opt both date fields into `type="date"`. Preserve payload and storage contracts; verify the browser-facing markup using the existing Vitest and jsdom stack.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Vitest 4, jsdom 29.

## Global Constraints

- No database schema, migration, API contract, dependency, or stored-data change.
- Preserve activity conversion to `YYYY-MM-DDT12:00:00.000Z` and task due dates as `YYYY-MM-DD`.
- Preserve blank optional-date behavior and all server-side validation.
- Do not change unrelated form fields, styles, accessibility announcements, or detail-page presentation.

## File structure and write ownership

- `src/components/NewOpportunityPage.test.tsx`: add rendered-DOM regression assertions for date and text input types.
- `src/components/ConnectionOpportunityForm.tsx`: add explicit input-type support and opt in the two date fields.
- `docs/plans/connection-date-inputs-ledger.md`: Root Sol records task status, checks, review findings, and acceptance evidence during execution. This file is root-owned and never written concurrently with worker files.

Only one implementation worker is required. Its write set is limited to the component and test files, so no concurrent writer is permitted or useful.

---

### Task 1 [CDI-1]: Render and verify native connection date controls

**Outcome:** Both connection date fields render as native date inputs while ordinary fields remain explicit text inputs; payload behavior remains unchanged.

**Dependencies:** None.

**Dependency wave:** Wave 1, serialized single worker.

**Risk:** Medium. This changes a shared form renderer and browser validation behavior, but not API or persistence contracts. Run focused checks and one `sol-reviewer` review immediately after the wave.

**Specification:** `docs/specs/connection-date-inputs.md`, especially Form interface, Payload and persistence, and Acceptance criteria 1-6.

**Write set:**

- Modify `src/components/NewOpportunityPage.test.tsx`.
- Modify `src/components/ConnectionOpportunityForm.tsx`.

**Existing contracts:**

- `buildConnectionCreationPayload(state: ConnectionFormState): ConnectionCreationPayload` remains unchanged.
- `ConnectionOpportunityForm` continues to call `onSubmit(buildConnectionCreationPayload(state))`.
- Storage remains the authoritative validator for direct API requests.

**Interfaces:**

- Consumes: current `ConnectionFormState`, `ConnectionOpportunityForm`, and Vitest/jsdom support.
- Produces: local renderer signature `input(key, label, required?, type?)`, where `type` is `"text" | "date"` and defaults to `"text"`.

- [ ] **Step 1: Add the jsdom directive and form import to the existing test file**

At the first line of `src/components/NewOpportunityPage.test.tsx`, add:

```tsx
// @vitest-environment jsdom
```

Retain the existing `renderToStaticMarkup` import. Import the form alongside the existing payload helper:

```tsx
import {
  buildConnectionCreationPayload,
  ConnectionOpportunityForm
} from "./ConnectionOpportunityForm";
```

- [ ] **Step 2: Write the failing rendered-DOM regression test**

Add this test to `src/components/NewOpportunityPage.test.tsx`:

```tsx
it("renders connection dates as date inputs and ordinary fields as text", () => {
  document.body.innerHTML = renderToStaticMarkup(
    <ConnectionOpportunityForm onSubmit={() => undefined} />
  );

  const inputFor = (label: string) => {
    const matchingLabel = Array.from(document.querySelectorAll("label")).find(
      (candidate) => candidate.querySelector("span")?.textContent === label
    );
    return matchingLabel?.querySelector("input") ?? null;
  };

  expect(inputFor("Date")?.getAttribute("type")).toBe("date");
  expect(inputFor("Due date")?.getAttribute("type")).toBe("date");
  expect(inputFor("Person's name")?.getAttribute("type")).toBe("text");
});
```

- [ ] **Step 3: Add deterministic coverage for existing blank-date behavior**

Add this test to `src/components/NewOpportunityPage.test.tsx`:

```tsx
it("preserves submission time and null due date when optional dates are blank", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-12T08:30:00.000Z"));

  try {
    const payload = buildConnectionCreationPayload({
      label: "Maya Chen",
      organization: "Acme",
      roleContext: "VP Engineering",
      contactInfo: "maya@example.com",
      meetingContext: "Example City engineering meetup",
      summary: "Met after a panel",
      relationshipStrength: "new",
      status: "new",
      priority: "medium",
      activityType: "meeting",
      activityBody: "Discussed platform leadership",
      activityDate: "",
      taskTitle: "Send portfolio",
      taskDueDate: ""
    });

    expect(payload.initialActivity?.occurredAt).toBe("2026-07-12T08:30:00.000Z");
    expect(payload.initialTask).toEqual({ title: "Send portfolio", dueDate: null });
  } finally {
    vi.useRealTimers();
  }
});
```

- [ ] **Step 4: Run the focused test and capture the expected failure**

Run:

```bash
npm test -- src/components/NewOpportunityPage.test.tsx
```

Expected evidence: the new test fails because the date controls have no `type` attribute; the existing payload test still passes.

- [ ] **Step 5: Add explicit type support to the local input renderer**

Replace the current one-line `input` helper in `src/components/ConnectionOpportunityForm.tsx` with:

```tsx
const input = (
  key: keyof ConnectionFormState,
  label: string,
  required = false,
  type: "text" | "date" = "text"
) => (
  <label className="application-form__field">
    <span className="application-form__label">{label}</span>
    <input
      className="application-form__input"
      required={required}
      type={type}
      value={state[key] as string}
      onChange={(event) => set(key, event.target.value as never)}
    />
  </label>
);
```

Do not alter state shape, payload conversion, or submission behavior.

- [ ] **Step 6: Opt both date fields into native date semantics**

Replace the Initial interaction helper call with:

```tsx
{input("activityDate", "Date", false, "date")}
```

Replace the Next action due-date helper call with:

```tsx
{input("taskDueDate", "Due date", false, "date")}
```

Leave `activityBody`, `taskTitle`, and all other helper calls on the default text type.

- [ ] **Step 7: Run the focused deterministic checks**

Run:

```bash
npm test -- src/components/NewOpportunityPage.test.tsx
npm test -- src/lib/storage.test.ts
```

Expected evidence: the rendered-DOM, payload-conversion, and blank-date tests pass. The existing storage tests named `requires strict ISO activity timestamps and records status and task lifecycle activities` and `rejects malformed dates and cross-opportunity source activity references` continue proving malformed activity timestamps and impossible task due dates are rejected.

- [ ] **Step 8: Run task-level static checks**

Run:

```bash
npm run typecheck
npm run lint
```

Expected evidence: both commands exit successfully with no TypeScript or ESLint errors.

- [ ] **Step 9: Record implementation evidence for review**

Root Sol records the focused test output, static-check output, changed files, known risks, and exact diff range in `docs/plans/connection-date-inputs-ledger.md`. A fresh `sol-reviewer` reviews Task CDI-1 against `docs/specs/connection-date-inputs.md` before final acceptance.

---

## Final acceptance

- [ ] Run the complete deterministic suite:

```bash
npm run verify
npm run build
```

Expected evidence: lint, TypeScript, all Vitest files, and the Next.js production build complete successfully.

- [ ] Start an isolated preview against a disposable SQLite database:

```bash
PREVIEW_DIR="$(mktemp -d)"
JOB_TRACKER_DB_PATH="$PREVIEW_DIR/jobtracker.sqlite" npm run dev -- --port 3001
```

- [ ] In a real browser, open `http://localhost:3001/opportunities/new?type=connection`, confirm both native date controls, submit interaction date `2026-07-10` and due date `2026-07-15`, and verify creation succeeds without an ISO timestamp error.

- [ ] On the created opportunity detail, verify the persisted interaction is dated `2026-07-10` and the open task due date is `2026-07-15`. Capture the detail response or visible timeline/task evidence for the final reviewer; the underlying activity value must remain `2026-07-10T12:00:00.000Z`.

- [ ] Provide the approved specification, plan, ledger, diff range, deterministic output, and browser evidence to one fresh `sol-final-reviewer`.

- [ ] Only after final-review approval, mark the single native Goal complete.
