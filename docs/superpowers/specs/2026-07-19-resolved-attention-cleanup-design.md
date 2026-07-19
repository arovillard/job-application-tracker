# Resolved Attention Cleanup Design

## Problem

The attention-context detail page keeps a full-width resolved banner after a user completes or cancels the targeted task. The banner provides safe keyboard-focus continuity, but it remains visible even though Activity history already records the result and the page's polite status region announces it.

## Approved behavior

- Completing or cancelling from the active attention banner keeps the existing “Action completed” or “Action cancelled” status announcement.
- After the successful response, the attention banner disappears, the `attention` and `taskId` URL parameters are removed with a replace navigation, and keyboard focus moves to the Actions section.
- A failed completion or cancellation leaves the active banner and its controls available.
- Opening a syntactically valid but stale attention URL shows a compact, neutral, dismissible notice explaining that the item was already handled. Dismissing it removes the stale attention parameters without adding a browser-history entry.
- A passive stale arrival does not receive programmatic focus. Dismissing its notice moves focus to the Actions section so the focused dismiss button is not removed underneath the user.
- Direct opportunity visits continue to show no attention surface.
- No animation, persistence, API, database, or task-state changes are introduced.

## Architecture

`OpportunityAttentionBanner` remains responsible only for active task and missing-next-action states. A separate `OpportunityAttentionNotice` presents passive stale-arrival feedback so a transient explanation cannot be confused with an actionable attention item.

`OpportunityDetailPage` distinguishes two resolution paths. A successful contextual task mutation immediately suppresses the attention surface, replaces the attention URL with the ordinary opportunity URL, preserves the live status message, and focuses the existing Actions section. An initially stale target derives a passive notice directly from the authoritative resolved state; dismissing the notice suppresses it, replaces the URL, and moves focus to Actions.

## Accessibility

- The task-action result remains exposed through the existing polite `role="status"` region.
- Focus moves synchronously after the successful render to `#opportunity-actions`, which is already programmatically focusable.
- Passive stale arrivals do not steal focus.
- Dismissing a stale notice moves focus to Actions.
- The stale notice uses visible text rather than color alone and has a native button with the existing minimum target-size styles.

## Verification

Component tests must prove the red-green behavior for contextual completion, cancellation, failed mutation, passive stale arrival, URL replacement, and focus placement. The focused component tests, full test suite, typecheck, lint, and production build must pass.
