# In-App Agent Workflow Goal

Paste the prompt below into a new JobTracker task started with `gpt-5.6-sol`.
Project-scoped agents are loaded when the task starts, so an already-open task may
need to be reopened before `terra-worker` and `sol-reviewer` are available.

```text
Execute this as a persistent Codex goal in the current JobTracker repository.
Resolve the project root by running `git rev-parse --show-toplevel` from the task's
working directory, and use that absolute path for all project commands.

Inspect the current goal with get_goal. If no unfinished goal exists, call
create_goal without a token_budget using this objective:

"Implement and verify a local-only in-app job-application agent workflow for
JobTracker using a host-controlled SQLite pipeline, native Codex and Claude CLI
adapters, deterministic database and artifact verification, and a
preview-before-run UI."

If a matching goal exists, continue it. Do not replace an unrelated unfinished
goal. Continue autonomously until complete unless genuinely blocked.

## Native agent policy

- The root task must use `gpt-5.6-sol`.
- Delegate every production edit, test implementation, and repair to the native
  project agent named `terra-worker`.
- Delegate every task review and the final review to the native project agent named
  `sol-reviewer`.
- Do not require a per-dispatch model override. The project agent files own model
  selection and reasoning effort.
- Do not use Ringer or nested `codex exec` processes for implementation
  orchestration.
- Before implementation, confirm both custom agent types are available. If either
  is unavailable, stop and report that project agents were not loaded. Do not
  substitute another model or agent type.
- The Sol controller may inspect, plan, dispatch, integrate returned patches, and
  run verification, but must dispatch a Terra worker for any source edit.
- Give every worker an explicit, disjoint write set. Never let agents edit the same
  file concurrently. Parallelize only independent tasks.

Treat the architecture below as approved. Inspect the repository, write a concise
design spec and detailed implementation plan, self-review them, and execute the
plan without requesting another design approval. Use an isolated
`codex/agent-application-workflow` branch or worktree. Preserve existing user
changes. Do not push or open a pull request.

Maintain a durable progress ledger. For each task, send the focused task brief to
one Terra worker, inspect its returned diff and test evidence, then send the same
requirements and diff to one fresh Sol reviewer. Send all blocking findings from a
review round to one Terra fixer and have Sol re-review before continuing.

## Required product architecture

- Add a chat-shaped "Apply with agent" drawer constrained in V1 to one public
  HTTP or HTTPS job URL per run.
- Store agent runs and sanitized events in SQLite with states `queued_preview`,
  `previewing`, `awaiting_approval`, `queued_execution`, `executing`, `verifying`,
  `succeeded`, `failed`, `cancelled`, and `interrupted`.
- Run long-lived work in a separate local worker process. API routes only enqueue,
  approve, cancel, and read runs. Process one mutating execution at a time and mark
  abandoned jobs interrupted instead of retrying them automatically.
- Preview through a schema-constrained, read-only provider invocation.
- After approval, JobTracker itself must run `scripts/upsert-job-posting.mjs`, parse
  its JSON, and verify the application record before invoking materials work.
- Invoke the materials agent with `job-application-resume` and require a structured
  artifact manifest.
- Independently verify file existence, path containment, expected artifact types,
  and SQLite readback. Register verified files with
  `scripts/register-application-artifact.mjs --application-id`. Never trust an
  agent's final message as proof.
- Implement fixed Codex and Claude adapters behind one typed interface. Allow only
  executable paths and model names in ignored local configuration. Launch with
  `spawn(command, args)` and no shell interpolation.
- Keep credentials in host CLI authentication. Never store API keys.
- Reject URLs with embedded credentials, non-HTTP schemes, localhost, loopback, or
  private-network targets. Treat posting content as untrusted prompt input.
- Never persist or display reasoning, raw environment values, or unsanitized CLI
  events. Verify output paths against `JOBTRACKER_APPLICATIONS_DIR`, including
  traversal and symlink cases.
- Add provider availability diagnostics, configurable default model, optional
  per-run model override, preview, approval, cancellation, sanitized progress,
  usage when available, and completion links to application artifacts.
- UI polling must stop at approval or a terminal state and must never invoke a
  model.

## Verification contract

Use TDD. Cover state transitions, worker leasing and restart recovery, URL and
private-address rejection, command construction, shell-injection prevention, path
containment, event redaction, deterministic upsert, artifact reconciliation,
cancellation, API behavior, and the UI workflow.

Run `npm run verify` and `npm run build`. Run fake-provider integration tests. Run
one real authenticated Codex smoke test using `gpt-5.6-terra`, a temporary
database, temporary applications directory, and synthetic resume. Use a current
CLI that advertises Terra, but do not commit a machine-specific executable path.
Require a real Claude smoke test only when Claude is installed and authenticated.

Start the development server and perform desktop and mobile browser checks. Confirm
private files remain ignored and uncommitted. Dispatch one final Sol reviewer for
the complete branch. Send all blocking findings to one Terra fixer and have Sol
re-review. Mark the goal complete only after all verification passes, the real
Codex workflow succeeds, artifacts appear in the application detail page, and no
blocking findings remain.

At completion, call update_goal with status complete and report the outcome,
verification evidence, smoke-test result, local URL, and remaining non-blocking
limitations.
```
