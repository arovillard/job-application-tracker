# Connection Date Inputs Specification

## Problem

The connection creation form renders its Initial interaction `Date` and Next action `Due date` controls through a generic input helper that omits the HTML `type` attribute. Browsers therefore treat both controls as free-form text. A user can enter a localized value such as `07/11/2026`; payload construction appends a UTC time to the activity value, producing an invalid timestamp that storage correctly rejects with `Activity occurrence time must be an ISO timestamp`.

## User outcomes

- Users select interaction and due dates with the browser's native date control.
- The browser supplies canonical date-only values in `YYYY-MM-DD` form.
- A selected interaction date continues to be stored as `YYYY-MM-DDT12:00:00.000Z`.
- A selected task due date continues to be stored as `YYYY-MM-DD`.
- Leaving either optional date blank preserves current behavior.
- The form cannot regress to plain text date controls without a deterministic test failure.

## Scope

- Change the connection form's generic input renderer so callers can specify an input type and all controls receive an explicit type.
- Render `activityDate` and `taskDueDate` with `type="date"`.
- Add rendered-DOM regression coverage for both date controls and a representative ordinary text control.
- Retain the existing payload conversion and server-side date validation as defense in depth.

## Non-goals

- No database schema, migration, or stored-data changes.
- No API contract changes.
- No redesign of activity timestamps or timezone semantics.
- No new browser-test framework or dependency.
- No unrelated changes to autofill, contact fields, error announcements, styling variables, or opportunity detail presentation.

## Current-state evidence

- The generic helper renders `<input>` without `type`, so HTML defaults every helper-generated control to text: `src/components/ConnectionOpportunityForm.tsx:50`.
- Both affected date fields use that helper: `src/components/ConnectionOpportunityForm.tsx:60` and `src/components/ConnectionOpportunityForm.tsx:62`.
- Payload construction assumes `activityDate` is already canonical and appends `T12:00:00.000Z`: `src/components/ConnectionOpportunityForm.tsx:30-34`.
- Storage requires activity timestamps to be ISO datetimes and task due dates to be real `YYYY-MM-DD` calendar dates: `src/lib/storage.ts:45` and `src/lib/storage.ts:170-181`.
- The existing payload test supplies `2026-07-10` directly and therefore bypasses rendered input semantics: `src/components/NewOpportunityPage.test.tsx:20-50`.
- The API delegates validation and creation to transactional storage: `src/app/api/opportunities/route.ts:68-81` and `src/lib/storage.ts:147-166`.

## Proposed behavior and architecture

### Form interface

The local `input` renderer accepts a fourth argument with the narrow type `"text" | "date"`, defaulting to `"text"`. It always writes the resulting `type` attribute. Existing non-date callers remain text fields; the two date callers explicitly request `"date"`.

The controlled value remains a string. Per HTML date-input behavior, a valid selected value is exposed to React as `YYYY-MM-DD`, while an unselected value is the empty string.

### Payload and persistence

No payload contract changes are required:

- Nonblank `activityDate` remains converted to `${activityDate}T12:00:00.000Z`.
- Blank `activityDate` with an interaction body remains submission-time `new Date().toISOString()`.
- Nonblank `taskDueDate` remains a date-only string.
- Blank `taskDueDate` remains `null` when a task is created.

Storage continues to reject malformed direct API requests. The native control improves user input but is not treated as a security boundary.

### Failure paths

- Browsers that support `type="date"` prevent arbitrary free-form text and apply native date validity checks before submission.
- Browsers with limited date-picker UI still expose date-input semantics and canonical values.
- Programmatic or malicious malformed requests remain rejected by existing storage validation with HTTP 400.
- A blank optional date remains valid and does not block submission.

## Security, privacy, compatibility, and rollback

- Security: no trust is transferred to the browser; server validation remains unchanged.
- Privacy: no new data is collected, transmitted, or logged.
- Compatibility: `input[type="date"]` is broadly supported; appearance remains browser/platform native while existing CSS classes remain applied.
- Migration: none. Existing records and SQLite files are untouched.
- Rollback: revert the component and regression-test commit; no data rollback is needed.

## Acceptance criteria

1. The rendered Initial interaction `Date` input has `type="date"`.
2. The rendered Next action `Due date` input has `type="date"`.
3. A representative ordinary field, `Person's name`, remains `type="text"`.
4. Selecting `2026-07-10` for an interaction still produces `2026-07-10T12:00:00.000Z`.
5. Selecting `2026-07-15` for a task still produces due date `2026-07-15`.
6. Existing blank-date behavior and server-side rejection of malformed dates remain unchanged.
7. Focused tests, the full verification suite, and the production build pass.

## Verification

```bash
npm test -- src/components/NewOpportunityPage.test.tsx
npm run verify
npm run build
```

Browser acceptance on the isolated preview:

1. Open `/opportunities/new?type=connection`.
2. Confirm both date fields use native date controls rather than free-form text controls.
3. Create a connection with interaction date `2026-07-10` and due date `2026-07-15`.
4. Confirm creation succeeds without an ISO timestamp error and the resulting activity/task retain those calendar dates.

## Material decisions and tradeoffs

- Use native HTML date controls rather than adding parsing for locale-specific free-form dates. This prevents ambiguity and adds no dependency.
- Preserve noon-UTC activity conversion. Changing timestamp semantics would be a separate product decision with migration and display implications.
- Add a rendered-DOM unit regression instead of introducing Playwright for this isolated defect. Final acceptance still includes a real browser check.

## Open decisions

None. The fix preserves all existing product and persistence semantics.
