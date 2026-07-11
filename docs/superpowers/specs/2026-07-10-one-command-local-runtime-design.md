# One-Command Local Runtime Design

## Goal

Make a cloned JobTracker installation usable through one documented startup command. `npm run dev` must start and supervise both the Next.js web app and the separate agent worker, and the UI must report worker availability honestly instead of presenting queued work as active validation.

The normal user experience is:

1. Ask an agent to clone and configure JobTracker.
2. The agent runs the documented installation and verification commands.
3. The agent runs `npm run dev` once.
4. The command reports that the web app and worker are ready and prints one local URL.
5. **Apply with Agent** works without the user knowing that the application has two processes.

## Problem

The repository currently has two incompatible startup contracts:

- `README.md` and `docs/agent-setup.md` tell an installer to run only `npm run dev`.
- `docs/agent-workflow.md` requires `npm run agent:worker` in one terminal and `npm run dev` in another.

The web app can enqueue a run without a worker. When that happens, `queued_preview` is currently displayed as **Validating public job URL**, even though no worker has claimed the run and no validation is happening. A user therefore sees an animated, increasing timer with no indication that the workflow cannot progress.

## Design Principles

- One command owns the normal local runtime.
- The worker remains a separate process from Next.js.
- Process and health state must be observable, not inferred from optimistic UI state.
- A queued run and an active run must have different language.
- Startup, shutdown, and failure behavior must work on macOS, Linux, and Windows without shell interpolation.
- Advanced web-only and worker-only commands remain available for debugging.
- No provider credentials, executable paths, process IDs, raw errors, or private filesystem paths are exposed through the health API or UI.

## Architecture

### Local process supervisor

Add `scripts/run-local.mjs` as the normal development entry point.

Package scripts become:

```json
{
  "dev": "node scripts/run-local.mjs",
  "dev:web": "next dev",
  "agent:worker": "tsx scripts/agent-worker.ts"
}
```

The supervisor resolves the installed Next.js and `tsx` entry points beneath the project `node_modules` directory and launches each with `process.execPath`, fixed argument arrays, `shell: false`, the project root as `cwd`, and the inherited local environment. It does not construct commands through a shell.

Arguments after `npm run dev --` are forwarded only to Next.js. For example:

```bash
npm run dev -- --port 3101
```

starts the worker normally and launches Next.js with `--port 3101`.

The supervisor prefixes line-oriented output with `[web]` or `[worker]`, while preserving the child exit status and avoiding printing environment values. It reports two explicit readiness signals:

- **Web ready:** derived from the Next.js local URL output.
- **Agent worker ready:** emitted by the worker only after storage initialization, startup recovery, and initial worker-health registration succeed.

The supervisor prints a final combined message only after both signals are present. Provider availability is still reported by the application; the supervisor does not invoke a model or perform token-consuming authentication checks.

### Lifecycle behavior

The supervisor owns both child processes:

- `SIGINT` and `SIGTERM` are forwarded to both children.
- The supervisor waits for bounded graceful shutdown and then terminates a child that does not exit.
- If either child exits unexpectedly, the supervisor terminates the other and exits nonzero.
- If a child fails before readiness, the supervisor prints one concise component-specific failure message.
- Expected shutdown from `Ctrl+C` does not print a false crash message.
- The worker is not automatically restarted in a loop. A crash remains visible and causes the combined command to fail instead of hiding a persistent defect.

The existing `npm run dev:web` and `npm run agent:worker` commands are documented as advanced debugging commands, not the normal installation path.

## Worker Health

### Durable health table

Add a dedicated SQLite table for worker liveness:

```sql
CREATE TABLE IF NOT EXISTS agent_worker_health (
  worker_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL
);
```

The table contains no PID, executable path, hostname, provider information, or error output.

The worker uses its existing unique worker ID and:

1. upserts its health row after storage initialization and startup recovery;
2. refreshes `heartbeat_at` every 5 seconds while its main loop is alive;
3. removes its own row during graceful shutdown;
4. best-effort removes stale rows during startup and health reads.

A worker is **online** when at least one row has `heartbeat_at` no more than 15 seconds old. Otherwise it is **offline**. The 15-second threshold is three heartbeat intervals and is shared by storage, API, UI tests, and documentation.

Multiple worker rows are allowed, even though the supervisor normally starts one. Existing lease and global-execution ownership rules remain authoritative for run processing.

### Safe health API

Add a read-only `GET /api/agent-worker-health` route returning:

```json
{
  "status": "online",
  "lastSeenAt": "2026-07-11T04:56:30.000Z"
}
```

or:

```json
{
  "status": "offline",
  "lastSeenAt": null
}
```

`lastSeenAt` is the newest valid heartbeat timestamp or `null`. Responses use `Cache-Control: no-store`. The route never returns worker IDs, paths, PIDs, database details, or internal errors. A health-read failure returns a safe offline response rather than raw diagnostics.

## Application Behavior

### Fresh drawer

The drawer fetches worker health alongside provider diagnostics.

- When the worker is online and a provider is available, **Start preview** is enabled.
- When the worker is offline, the drawer shows **Agent worker is offline. Start JobTracker with `npm run dev`.** and disables **Start preview**.
- The provider-unavailable and worker-offline messages remain distinct.
- The drawer refreshes worker health every 5 seconds while open, so the action becomes available without closing the drawer after a worker reconnects.

Disabling the action prevents knowingly creating an indefinitely queued run. A race can still occur if the worker stops after the health check; queued-state behavior handles that case.

### Queued runs

`queued_preview` and `queued_execution` never use active-operation labels.

- `queued_preview` with an online worker shows **Waiting for agent worker**.
- `queued_preview` with an offline worker shows **Agent worker is offline** and **Waiting to reconnect**.
- `queued_execution` uses the equivalent waiting/offline language for approved work.
- Queued states retain **Cancel**.
- A queued run continues automatically when a worker becomes healthy and claims it; no manual retry or duplicate run is created.

The activity spinner is used only when a worker is online and the run is expected to be claimed promptly. Offline waiting uses a static warning treatment. The elapsed timer remains visible in both cases and is labeled as queue time rather than work time.

### Active runs

Only worker-owned active states show work stages:

- `previewing` may show **Validating public job URL**, **Retrieving public job posting**, or **Analyzing job posting** from safe host events.
- `executing` and `verifying` retain their existing material-generation and verification stages.

The worker appends **Validating public job URL.** only after it has claimed the run and transitioned it to `previewing`. Existing retrieval deadlines, cancellation, lease fencing, privacy, structured posting evidence, approval, and artifact verification remain unchanged.

### Worker loss during active work

If the worker heartbeat expires while a run is active, the UI shows **Agent worker connection lost** while storage recovery retains authority over the final state. The UI does not immediately rewrite the run state. Existing lease expiry and recovery eventually transition abandoned active work to `interrupted`; work is never retried automatically.

## Installation and Everyday Startup

The normal agent-managed installation contract becomes:

```bash
npm install
npm run setup
npm run skills:install
npm run verify
npm run build
npm run dev
```

The installing agent must:

1. verify Node.js 20.18.1 or newer, npm, and Git;
2. collect and configure the private application paths and provider choice;
3. install skills;
4. run verification and build;
5. start the one-command runtime;
6. wait for both **Web ready** and **Agent worker ready**;
7. confirm `GET /api/agent-worker-health` reports `online`;
8. confirm the selected provider executable is available through the existing provider diagnostics;
9. report the local URL and whether provider authentication was verified by a supported non-token-consuming mechanism; otherwise state that authentication will be confirmed by the first preview;
10. confirm private files remain ignored and uncommitted.

The agent must not claim setup is ready merely because the web URL responds.

Everyday startup is one command:

```bash
npm run dev
```

Everyday shutdown is one `Ctrl+C` in the supervising terminal.

Update `README.md`, `docs/agent-setup.md`, `docs/agent-workflow.md`, and the repository setup instructions so this contract is identical everywhere. The two-terminal commands remain in an **Advanced debugging** subsection only.

## Failure Handling

- **Worker cannot initialize storage:** combined startup fails; the web process is stopped.
- **Web process cannot bind its port:** combined startup fails; the worker is stopped.
- **Worker crashes after readiness:** combined startup exits nonzero after stopping the web process.
- **Web process crashes after readiness:** combined startup exits nonzero after stopping the worker.
- **Browser opened while worker is offline:** the drawer names the offline worker and disables new preview creation.
- **Worker stops after enqueue:** the run remains honestly queued, can be cancelled, and continues when a worker reconnects.
- **Worker disappears during active work:** UI reports lost connection; lease recovery determines `interrupted` safely.
- **Health storage/API failure:** UI treats health as offline and exposes no raw error.

## Testing Strategy

### Supervisor tests

Test `scripts/run-local.mjs` through injectable spawn/process adapters:

- launches the exact Next.js and `tsx` entry points with fixed arrays and `shell: false`;
- forwards web arguments only to Next.js;
- recognizes both readiness signals before reporting combined readiness;
- prefixes child output without leaking environment values;
- forwards `SIGINT` and `SIGTERM`;
- stops the sibling and exits nonzero when either child fails;
- treats `Ctrl+C` as an expected shutdown;
- escalates after the graceful-shutdown deadline.

### Storage and worker tests

- schema migration is idempotent;
- registration and 5-second heartbeat updates use the same worker ID;
- health is online through 15 seconds and offline after the threshold;
- graceful shutdown removes only the current worker row;
- multiple workers report the newest valid heartbeat;
- stale cleanup cannot affect run leases or execution ownership;
- worker readiness is not emitted before recovery and health registration succeed.

### API tests

- online and offline payloads match the exact public shape;
- newest valid `lastSeenAt` is returned;
- response is not cached;
- read failures collapse to the safe offline payload;
- no private worker fields are serialized.

### Drawer and orchestration tests

- fresh offline drawer disables **Start preview** with actionable copy;
- health polling enables the action after reconnect;
- online queued runs say **Waiting for agent worker**;
- offline queued runs say **Agent worker is offline / Waiting to reconnect**;
- queued states never say **Validating public job URL**;
- `previewing` begins with **Validating public job URL**;
- queued cancellation remains available;
- a worker that reconnects claims the existing queued run without duplication;
- active heartbeat loss reports connection loss until recovery transitions the run.

### Documentation and release checks

- static assertions ensure normal setup documentation uses `npm run dev` as the single startup command;
- two-terminal commands appear only in advanced debugging documentation;
- full `npm run verify` and `npm run build` pass;
- real local smoke confirms one command starts both components, health reports online, a queued preview is claimed promptly, and one `Ctrl+C` stops both;
- browser smoke confirms accurate online, offline, queued, active, and reconnect states without console errors.

## Out of Scope

- Production deployment or operating-system service installation.
- Automatically restarting a repeatedly crashing worker.
- Moving provider execution into the Next.js process.
- Changing provider credentials or authentication storage.
- Retrying interrupted application-material generation automatically.
- Altering posting retrieval, structured evidence, approval, or artifact safety rules.

## Acceptance Criteria

The work is complete when:

1. a fresh configured clone starts both required processes with `npm run dev`;
2. one `Ctrl+C` stops both processes;
3. the supervisor fails visibly if either component fails;
4. the app reports worker health through a safe, uncached API;
5. an offline worker is visible before submission and disables new preview creation;
6. queued runs never claim that validation is occurring;
7. an existing queued run continues after the worker reconnects;
8. active worker loss is reported and existing lease recovery remains authoritative;
9. all setup documentation and agent prompts use the same one-command contract;
10. focused tests, full verification, build, runtime smoke, browser smoke, privacy audit, and independent review pass.
