# Application Materials Preflight Design

## Problem

The in-app workflow allows approval when no readable base resume is configured. Codex then runs an expensive materials task without required source material, may return an empty manifest, and the UI only reports a generic artifact reconciliation failure. The materials sandbox also grants the applications directory but not the directory containing an external base resume.

## Approved Design

The approval route must verify `JOBTRACKER_BASE_RESUME_PATH` resolves to a readable regular file before changing an awaiting run to `queued_execution`. A missing or invalid file returns HTTP 409 with the safe message `Base resume is not configured or readable. Choose a base resume in JobTracker setup before creating materials.` The run remains awaiting approval and no provider tokens are spent.

For Codex materials only, the provider invocation adds the base resume's parent directory as an explicit read/write sandbox root when it is outside the existing project/applications roots. Preview isolation remains unchanged.

Artifact reconciliation must require one `fit_analysis`, one `outreach_message`, and one `resume` entry. The existing path, type, extension, content-type, containment, and regular-file checks remain authoritative.

The selected ignored local configuration is:

- Database: this worktree's `data/jobtracker.sqlite`.
- Applications: this worktree's `applications/` directory.
- Base resume: `<user-home>/Downloads/Alejandro Rovillard - resume.pdf`.

## Acceptance Contract

1. Approval is blocked before mutation when the base resume is missing, unreadable, or not a regular file.
2. Codex materials receives explicit sandbox access to the selected external resume directory; preview does not.
3. Empty or partial manifests cannot reach success.
4. Focused tests, full verification, and production build pass.
5. A fresh lululemon run completes with a verified fit analysis, outreach message, and PDF resume registered to one application.
