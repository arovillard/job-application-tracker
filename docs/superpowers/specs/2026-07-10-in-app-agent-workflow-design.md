# In-App Agent Workflow Design

**Date:** 2026-07-10

## Outcome

JobTracker adds a local-only **Apply with agent** drawer. A user submits one public HTTP(S) job URL, chooses Codex or Claude and optionally overrides the model, reviews a schema-constrained preview, and explicitly approves execution. JobTracker—not the model—owns the SQLite writes, state transitions, verification, and artifact registration.

## Approaches considered

1. **Selected: SQLite queue plus one local worker process.** API routes make short transactions; a separate `npm run agent:worker` process leases runs and performs long-lived CLI work. This fits the local-first app, makes restart recovery deterministic, and keeps model execution out of request lifetimes.
2. **One process per HTTP request.** This is simpler to start, but request cancellation/restarts can orphan subprocesses and make approval and recovery unreliable.
3. **External queue/service.** This offers distributed scheduling, but adds credentials, deployment, and network infrastructure that conflict with the local-only V1.

## Boundaries and components

### Domain and persistence

`src/lib/agent-workflow/types.ts` defines providers, run states, preview data, artifact manifests, public run views, diagnostics, and sanitized event kinds. `src/lib/agent-workflow/storage.ts` owns two SQLite tables:

- `agent_runs`: provider/model, canonical job URL, state, preview JSON, application id, usage JSON, cancellation flag, lease metadata, safe failure code/message, and timestamps.
- `agent_run_events`: monotonic per-run sequence, allowlisted event kind/message, optional safe metadata JSON, and timestamp.

The states are exactly `queued_preview`, `previewing`, `awaiting_approval`, `queued_execution`, `executing`, `verifying`, `succeeded`, `failed`, `cancelled`, and `interrupted`. Storage exposes compare-and-set transitions. Approval only accepts `awaiting_approval`; cancellation immediately closes queued/approval states and marks active states for cooperative termination. On worker startup, leased nonterminal work from an earlier worker is marked `interrupted`; it is never retried automatically. A single SQLite lease mutex permits only one mutating execution at a time.

### Local configuration and diagnostics

The ignored `jobtracker.agent.local.json` contains only executable paths and default model names for Codex and Claude. A tracked example documents the shape. Unknown keys, arguments embedded in executable paths, empty model values, credentials, and environment maps are rejected. A run-level model override must be a single safe model identifier; it never becomes a shell fragment.

Diagnostics resolve the configured executable directly or through `PATH` and invoke only `--version` with `spawn(command, args)`. They expose availability plus a bounded, sanitized version string. Authentication stays in each host CLI and no key is accepted or persisted.

### Input and output security

Before enqueueing, URL validation requires one absolute `http:` or `https:` URL, forbids embedded credentials, localhost names, IP literals in private/loopback/link-local/reserved ranges, and hostnames whose A or AAAA answers resolve to those ranges. The canonical URL is passed to the provider as untrusted posting content, never interpolated into command arguments or a shell.

CLI adapters receive typed requests and build fixed argument arrays. Preview runs are read-only and schema-constrained. Execution runs are limited to the project and configured applications directory. JSONL/stdout events are parsed in memory and reduced to allowlisted progress and usage fields; stderr, reasoning, raw environment values, prompts, tool arguments, and unrecognized event fields are never persisted or returned.

Artifact verification requires an existing regular file. Both the configured applications root and artifact are resolved with `realpath`; the artifact must remain inside the root after symlink resolution. Its declared type and extension/content type must match the supported artifact contract. Only then does JobTracker invoke `scripts/register-application-artifact.mjs --application-id` with a fixed argument array and verify SQLite readback.

### Provider adapters

Both providers implement one typed interface with `diagnose`, `preview`, and `createMaterials` methods.

- Codex preview uses `codex exec --ephemeral --json --sandbox read-only --output-schema ... --output-last-message ... --model ... --cd ... -`.
- Codex execution uses the same noninteractive structured-output path with `workspace-write` and the applications directory as an additional writable directory.
- Claude preview uses `claude -p --output-format stream-json --json-schema ... --permission-mode plan --tools WebFetch,WebSearch --model ...`.
- Claude execution uses `--permission-mode acceptEdits`, project skill discovery, and a narrow tool allowlist needed to read sources and create application files.

Prompts label the posting as untrusted, forbid following posting instructions, forbid database writes and artifact registration by the model, require `job-application-resume` for materials, and require a structured artifact manifest. The worker, not the adapter, owns all downstream verification.

### Worker data flow

1. API validates and inserts `queued_preview`.
2. Worker leases it, transitions to `previewing`, runs the read-only provider, validates the schema, stores the safe preview, and transitions to `awaiting_approval`.
3. Approval API atomically transitions to `queued_execution`.
4. Worker obtains the global execution lease and transitions to `executing`.
5. JobTracker runs `node scripts/upsert-job-posting.mjs --input-json - --reactivate`, parses its JSON, and verifies company, role, canonical URL, action, status, application id, changes, and note ids by SQLite readback.
6. The materials provider runs with the verified application context and `job-application-resume`, returning a manifest only.
7. Worker transitions to `verifying`, reconciles every manifest entry against the filesystem and allowed root, registers it with `scripts/register-application-artifact.mjs --application-id`, and checks the database.
8. Worker records safe completion links and transitions to `succeeded`. Any deterministic failure becomes `failed`; cancellation becomes `cancelled`; abandoned active work becomes `interrupted`.

### API and UI

Routes only enqueue, approve, cancel, diagnose, and read. They never launch a model. The public run representation contains safe state, preview, sanitized events, usage when available, errors, and application/artifact links.

The dashboard header opens a chat-shaped drawer. The first message asks for one job URL and offers provider/model controls plus availability. During preview it shows sanitized progress. At `awaiting_approval`, polling stops and the user sees extracted company, role, location, summary, posting state, provider/model, and an explicit approval action. Polling resumes only after approval and stops again at any terminal state. Cancellation is available before completion. Success links to the application detail page and registered artifacts. The drawer becomes full-width on narrow screens and maintains accessible dialog, focus, label, and live-region behavior.

## Error handling and privacy

Failures use stable codes and user-safe messages. Provider output is untrusted even when schema-valid. Raw subprocess output is never stored. Child processes receive only the environment needed for host CLI auth and JobTracker paths; environment values are never surfaced. Temporary schemas/output files are removed in `finally` blocks. No automatic retry occurs after interruption. Local configuration, SQLite files, synthetic smoke inputs, and generated application files stay ignored and uncommitted.

## Verification

TDD covers transition legality, leases and restart recovery, URL/DNS rejection, command construction, shell-injection payloads, model validation, event redaction, path traversal and symlinks, deterministic upsert/readback, artifact reconciliation, cancellation, route behavior, and polling/approval UI behavior. A fake provider runs the full queue-to-artifact pipeline in temporary directories. Final verification runs `npm run verify`, `npm run build`, a real authenticated Codex smoke using `gpt-5.6-terra`, and a Claude smoke only when Claude is installed and authenticated. Desktop and mobile browser checks verify the drawer and artifact links.

## Self-review

- No placeholders or deferred decisions remain.
- The worker/process boundary matches the required local-only architecture.
- Every mutation has a host-controlled verification step.
- Preview is read-only and execution requires explicit approval.
- Security rules cover command injection, SSRF-style local targets, event leakage, traversal, and symlink escape.
- The plan below assigns every production/test edit to Terra and every review to a fresh Sol reviewer.
