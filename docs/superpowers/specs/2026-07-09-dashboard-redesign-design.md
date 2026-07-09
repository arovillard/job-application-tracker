# Quiet Intelligence Dashboard Redesign

## Goal

Transform Job Tracker from a record-keeping table into a calm, action-first workspace that makes the next step in a job search obvious on desktop and mobile.

## Product Decisions

- The dashboard prioritizes due work and active pipeline health over historical reporting.
- The visual direction is quiet intelligence: editorial typography, restrained color, generous spacing, and high information clarity rather than decorative effects.
- Applications gain optional `priority`, `nextAction`, and `nextActionDate` fields. These are the source of truth for the attention queue; scheduled follow-up notes remain compatible and are still surfaced.
- The app keeps its local-first SQLite and Next.js architecture. No external services, authentication, or telemetry are introduced.

## Dashboard Information Architecture

1. **Workspace header:** title, theme toggle, keyboard discoverability, and an obvious new-application action.
2. **Pipeline overview:** four clickable metrics—active applications, follow-ups requiring attention, interviewing, and offers.
3. **Attention queue:** shows overdue/today follow-ups, explicit next actions, and applications that need a next action. It explains why an item needs attention and links directly to the application workspace.
4. **Pipeline controls:** saved views, search, sorting, and status filtering.
5. **Application list:** a desktop table with compact semantic stage controls and a mobile card layout; rows expose company, role, next action, due date, status, and a non-destructive detail entrypoint.

## Interaction Design

- `N` opens the new-application page; `/` and `Cmd/Ctrl+K` focus search, except while typing in a form control.
- Saved views are local UI filters: all, active, needs attention, interviewing, and archived.
- Clicking a metric changes the selected view/status filter and scrolls the list into view.
- Status changes produce a transient success toast with an Undo action. Undo records a normal reverse status transition so the activity history remains accurate.
- Application details use a persistent action bar. Note, status, details, and delete actions use a single accessible modal pattern with Escape, backdrop, focus restoration, busy buttons, and destructive confirmation.

## Responsive and Accessible Behavior

- Desktop retains the dense table; mobile renders cards rather than requiring the user to interpret a wide data grid.
- Controls have a minimum 44px touch target. Visual focus is intentional and visible.
- Status color is supplementary: every stage carries text and is readable without color.
- Motion uses short opacity/transform transitions, skeleton loading states, and a reduced-motion override.
- The chosen color theme is persisted locally and can be switched between light and dark.

## Data and Error Handling

- SQLite migration uses additive columns so existing databases remain valid.
- The server validates priority and date values alongside existing application input validation.
- Failed fetches retain the existing error notice; successful mutations update the local dashboard state before a subsequent refresh is needed.
- Empty states contain a direct route to creating an application rather than only explanatory copy.

## Verification

- Storage tests cover the new application-workspace fields and migration-compatible persistence.
- Dashboard insight tests cover active counts, due work, and missing-next-action detection deterministically with a provided date.
- The full test, lint, typecheck, and production build must pass.
- Browser verification covers empty state, populated dashboard, search shortcut, theme toggle, responsive layout, and modal keyboard behavior.
