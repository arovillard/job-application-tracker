# Workspace-First Dashboard

## Goal

Make the dashboard a repeat-use workspace rather than a first-run landing page. A returning user should reach their opportunities and their current state without scrolling past branding or explanatory content.

## Approved Direction

Use the table-first layout. The opportunity pipeline begins immediately below the compact product header. Attention is a dense, supporting strip within that workspace rather than a separate feature panel. Creating an opportunity remains available from the header, and progress information moves below the working list.

## Alternatives Considered

1. **Table-first workspace (chosen):** opportunity controls and rows occupy the first viewport; attention is a compact strip. This best matches daily review and keeps the page dense without losing context.
2. **Persistent desktop side panel:** opportunities on the left and attention on the right. This keeps attention visible but reduces the table width and collapses awkwardly on smaller screens.
3. **Tabbed views:** separate pipeline, attention, and progress views. This makes each view simpler but adds navigation to the core daily review loop.

## Information Architecture

1. **Compact header:** product name, theme control, search shortcut, and one `New application` command. It remains a tool header, not a hero.
2. **Opportunity workspace:** `Your opportunities`, current result count, saved views, search, sorting, stage filters, and the application list. This begins directly after the header.
3. **Attention strip:** when work needs attention, show a concise count, the first few actionable items, and an affordance to filter the list to those records. It does not use a separate card, large heading, or explanatory paragraph.
4. **Progress overview:** the existing pipeline metrics appear after the list as a compact review section. They remain interactive and can still focus the corresponding list view.
5. **Empty state:** for a new user, the empty list contains the creation action and brief supporting copy. The standalone quick-capture panel is removed because it duplicates the header action and competes with the list.

## Interaction Details

- The header `New application` action remains the primary creation entry point and retains its keyboard shortcut.
- Saved views, search, sorting, and status filtering continue to work as they do today.
- Selecting the attention strip sets the existing `Needs attention` view and focuses the list without a long scroll.
- Selecting a progress metric applies its existing corresponding view/status filter and focuses the list.
- The progress overview no longer scrolls users down to the table because the table is already the first working surface.

## Visual Direction

- Remove the dashboard intro headline, supporting copy, and its large vertical spacing.
- Treat the workspace title and controls as an operational toolbar: compact, left-aligned, and immediately followed by records.
- The attention strip uses a subtle semantic background and compact links, not a card-in-card treatment.
- Keep the typography and restrained color system from the current design, but reserve editorial scale for actual content such as an opportunity detail page, not the dashboard landing state.
- On mobile, the same order is preserved: header, workspace controls, attention strip, list, then progress. The strip wraps into a concise vertical list while cards remain the application-list presentation.

## Scope and Verification

- Modify the dashboard composition and its supporting attention/overview/quick-capture components and styles only.
- Do not change the SQLite schema, API contracts, application records, or existing keyboard shortcuts.
- Test the existing dashboard insight behavior, then run `npm run verify` and `npm run build`.
- Verify desktop and mobile layouts with populated and empty data, including attention filtering and progress-metric filtering.
