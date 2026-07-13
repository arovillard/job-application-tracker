# Compact Detail and Dashboard Design

## Goal

Move useful opportunity content higher in the viewport and turn Next action into a deliberate decision surface while preserving the blue-led visual system and all behavior.

## Design

- Render `Pipeline · Your opportunities` as one baseline-aligned dashboard lockup.
- Add a compact command header: breadcrumb and type share the top line; title and metadata anchor the left; stage and actions form one control cluster on the right; the workspace begins immediately below.
- Present the primary task as an `Up next` card: task and due state first, Complete and Cancel second, and rescheduling in a separate labeled row.
- Consolidate next action, remaining tasks, and history into one `Actions` card; replace technical snapshots with compact `About` cards that omit unset facts.
- Stack rescheduling controls at narrow widths; preserve 44px controls, keyboard semantics, local dates, callbacks, themes, and reduced motion.

## Acceptance

- Dashboard title occupies one line at desktop widths.
- Activity history starts materially higher in the detail viewport.
- Next action has clear task, due-state, immediate-action, and rescheduling hierarchy.
- No API, persistence, modal, or animation changes.
