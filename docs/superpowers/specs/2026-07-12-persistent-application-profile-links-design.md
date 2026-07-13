# Persistent Application Profile Links Design

## Problem

The application-readiness branch can safely write resume and LinkedIn references to the ignored `.env.local` file, and fresh local tasks can read those values. However, repository routing does not explicitly classify a profile-only request such as “save my resume and LinkedIn links” as application workflow intent. A fresh agent can therefore acknowledge the links without invoking the persistence command, which causes later tasks to ask for them again.

## User Outcome

A user can provide a Google Docs resume URL or local resume path together with a public LinkedIn/profile URL in one message. The agent saves every supplied allowlisted value in the project’s private configuration, reruns readiness, asks only for any genuinely missing blocking information, and announces when the workspace is ready for a job-posting link.

## Design

Repository instructions and the packaged `job-application-workflow` skill will treat requests to configure, save, remember, or update application-profile references as application intent. This includes resume files, Google Docs resume URLs, LinkedIn URLs, and other public professional-profile URLs supplied for job applications.

The coordinator remains the only orchestration entrypoint. When the user supplies more than one allowlisted value in the same message, it will persist those supplied values together through `scripts/configure-application-profile.mjs` instead of discarding one value and asking for it again. Values not supplied by the user remain unchanged.

The persistence target remains `.env.local` for local checkouts:

- `JOBTRACKER_BASE_RESUME_URL` for the preferred private Google Doc.
- `JOBTRACKER_BASE_RESUME_PATH` for a local DOCX, PDF, Markdown, or text source.
- `JOBTRACKER_LINKEDIN_URL` for the public professional profile.
- `JOBTRACKER_APPLICATIONS_DIR` for generated application materials.

The existing safe writer continues to allowlist keys, preserve unrelated configuration and comments, use restrictive permissions, reject simultaneous nonempty resume URL and path values, and return only a redacted summary. Personal URLs and paths must not be written to `AGENTS.md`, committed files, logs, tests, or documentation examples containing real user data.

## Fresh-Task Behavior

On a new local task in the same checkout, Codex or Claude reads the committed repository instructions, invokes the coordinator, and the readiness command reloads `.env.local`. The agent does not ask for valid configured values again. It may still ask the user to reconnect Google Drive if the host cannot access the saved private document.

On Codex Cloud, ignored `.env.local` files are not cloned. The same setting names can be configured as cloud environment variables, which the existing readiness reader already accepts as overrides. The repository documentation will state this boundary clearly; application-profile links must not be placed in Git to bridge local and cloud checkouts.

## Error Handling

- Invalid Google Docs URLs are rejected without replacing the last valid source.
- Inaccessible Google Docs remain configured while the user is asked to reconnect Drive or provide a local fallback.
- A moved or unreadable local resume is reported as invalid and requested again.
- A missing public profile remains a warning rather than blocking job application work.
- Unknown configuration fields and credential-like input remain rejected by the safe writer.

## Verification

Automated contract tests will prove that:

1. Repository instructions route profile-configuration language through the coordinator.
2. Codex and Claude coordinator copies advertise the same trigger behavior.
3. A message containing both resume and profile references is required to persist all supplied allowlisted fields together.
4. The coordinator reruns readiness and does not ask again for already valid persisted values.
5. Documentation explains local `.env.local` persistence and cloud environment-variable configuration without recommending committed personal data.

Focused tests will run first, followed by the repository verification suite, production build, Git whitespace checks, and a post-merge verification on `main`.

## Scope

This change strengthens routing, orchestration instructions, documentation, and tests. It does not add an account system, database fields for personal profile settings, a new web settings page, Google credentials, public document sharing, or automatic cloud-environment mutation.
