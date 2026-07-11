# Codex Preview Trust Fix Design

## Problem

JobTracker runs Codex preview generation from an app-owned temporary directory so the provider cannot read the project or application materials. Current Codex CLI versions reject that directory before processing the prompt because it is not a trusted Git repository. The provider converts the resulting nonzero exit into `preview_failed`, and the drawer displays the generic safe fallback.

The failure is reproducible with `https://www.linkedin.com/jobs/view/4427875246`: host retrieval completes, then Codex exits during `Analyzing job posting.` with `Not inside a trusted directory and --skip-git-repo-check was not specified.`

## Approved Approach

Add Codex's `--skip-git-repo-check` flag only to preview invocations. Preview already uses an isolated temporary working directory, `--ignore-user-config`, and the read-only sandbox. Materials generation continues to run from the real project root without the flag.

This is preferred over moving preview back into the repository because the temporary directory is an intentional security boundary. It is preferred over marking temporary directories trusted because that would require persistent user configuration and would conflict with ephemeral preview execution.

LinkedIn's current public guest response does not include a complete schema.org `JobPosting`, although it exposes the role and company in the document title and the full job description in visible page text. For a validated `linkedin.com` subdomain whose path begins `/jobs/view/`, retrieval may therefore create structured evidence only when the title matches LinkedIn's exact `company hiring role in location | LinkedIn` pattern and visible page text is non-empty. This fallback remains host-derived and site-specific; generic pages and other hosts continue to require complete schema.org evidence.

## Testing Contract

1. The exact preview invocation contains `--skip-git-repo-check` and retains the temporary `cwd`, read-only sandbox, and stdin-only prompt.
2. The materials invocation does not gain the flag.
3. A LinkedIn guest page without JSON-LD produces host-grounded title, company, and description evidence only on validated LinkedIn job-view URLs.
4. The focused provider and retrieval suites, full verification suite, and production build pass.
5. A real live run of the supplied LinkedIn URL reaches `awaiting_approval` with identified company and role before the fix is called complete.

## Scope

- Modify `src/lib/agent-workflow/providers.ts`.
- Modify `src/lib/agent-workflow/providers.test.ts`.
- Modify `src/lib/agent-workflow/retrieval.ts` and `src/lib/agent-workflow/retrieval.test.ts` for the narrow LinkedIn evidence fallback.
- Do not change prompts, UI copy, persistence, provider credentials, or materials execution.
- Preserve the user's existing uncommitted and untracked files.
