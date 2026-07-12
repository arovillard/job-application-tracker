# Opportunity UI Alignment Design

## Objective

Align jobs and connections with the established JobTracker application interface while removing the intermediate opportunity-type chooser. The existing application creation and detail screenshots supplied by the user are the visual source of truth.

## Scope

- Replace the dashboard's direct New opportunity navigation with one menu button containing Job posting and Connection options.
- Navigate each menu option directly to its typed creation form.
- Remove the standalone opportunity-type chooser from the creation route.
- Repair opportunity detail markup and inline forms so they use the existing design-system classes and established application layout.
- Correct obsolete CSS variables and component/stylesheet selector mismatches affecting the opportunity UI.
- Preserve all existing opportunity, activity, task, artifact, and persistence behavior.

## Non-goals

- No new visual language, typography, color palette, or component library.
- No database, API, migration, status-model, or workflow changes.
- No change to the recently corrected native date-input behavior.
- No browser automation performed by Codex; the user will perform browser verification.

## Dashboard creation menu

The existing primary New opportunity control becomes a single menu button with the same visual weight and placement. Activating it opens a compact anchored menu with two choices:

- Job posting: navigates to `/opportunities/new?type=job`.
- Connection: navigates to `/opportunities/new?type=connection`.

The menu supports pointer use, keyboard focus, Escape dismissal, and outside-click dismissal. It uses existing surface, border, radius, shadow, type, and focus styles. It does not create a primary default action; choosing one of the two records is required.

## Creation route

`NewOpportunityPage` derives its form from the `type` query parameter and renders the requested form immediately. There is no intermediate chooser. A direct visit to `/opportunities/new` falls back to the job-posting form for backward compatibility.

The page retains the established creation-page shell: eyebrow, title, dashboard/opportunities return action, bordered panel, field grid, optional sections, and primary submit action. Connection-specific terminology changes content only, not structure or styling.

## Opportunity detail layout

The detail page follows the original application detail composition:

- Header: back navigation, opportunity type eyebrow, title, stage indicator/control, and aligned action bar.
- Main column: activity history first, then application materials for jobs.
- Sidebar: next-action card first, then structured opportunity details.
- Responsive behavior: sidebar moves above the main column at tablet width and becomes a single column on mobile, matching existing breakpoints.

Next actions use the existing `next-action-card` treatment. Details use `tracker-panel__header` and `detail-list` rather than unstructured paragraphs. Activity and materials use panel headers with counts and correctly padded content.

## Inline forms

Record interaction, Add task, Edit details, and Create job opportunity appear as styled tracker panels. Their controls use the existing application form classes:

- `application-form`
- `application-form__grid`
- `application-form__field`
- `application-form__label`
- `application-form__input`
- `application-form__select`
- `application-form__textarea`
- `application-form__actions`

Buttons retain existing primary, secondary, and danger treatments. Native date controls remain `type="date"`. Opening or closing a form does not change persistence behavior.

## CSS repair

- Make detail component class names and stylesheet selectors identical.
- Replace obsolete `--border` and `--text-muted` references with the active `--line` and `--ink-muted` tokens.
- Remove superseded chooser styles after the chooser is removed.
- Add only the menu and inline-form selectors necessary to reuse the current visual system.
- Preserve existing desktop and mobile breakpoints.

## Data flow and errors

The dashboard menu changes navigation only. Creation and detail mutations continue using the existing API calls and payloads. Existing loading, disabled-button, and API error behavior remains unchanged. The menu itself owns only open/closed UI state and performs no data mutation.

## Verification contract

Codex will implement code-level regression coverage for menu destinations, direct typed form rendering, and required styling hooks. Codex will not perform browser verification.

The user will visually verify:

- Dashboard creation dropdown.
- Job and connection creation forms.
- Job and connection detail pages.
- Record interaction, Add task, Edit details, and Create job opportunity panels.
- Desktop and mobile layouts.

Acceptance requires visual alignment with the supplied original application screenshots, not merely successful rendering, DOM text, tests, or builds.
