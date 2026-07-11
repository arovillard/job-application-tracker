# Local Agent Workflow

JobTracker can inspect one public job posting, pause for approval, and then create and independently verify application materials. The Next.js app only enqueues and reads work; provider processes run in the separate local worker.

## Local configuration

Copy `jobtracker.agent.example.json` to the ignored `jobtracker.agent.local.json` when the defaults do not match the machine:

```json
{
  "codex": {
    "executablePath": "/opt/homebrew/bin/codex",
    "defaultModel": "gpt-5.6-terra"
  },
  "claude": {
    "executablePath": "claude",
    "defaultModel": "sonnet"
  }
}
```

Only an executable path and default model are accepted for each provider. The file is strict: command arguments, environment maps, credentials, and additional fields are rejected. Keep authentication in the provider CLI's own secure setup. Do not put API keys or provider secrets in this repository, `.env.local`, or the JSON config.

The configured `defaultModel` is used when a run has no override. The Apply with agent drawer and smoke command can supply one model identifier for that run; it is passed as one argument, never interpreted by a shell.

Set the existing paths in `.env.local`:

```dotenv
JOBTRACKER_DB_PATH="./data/jobtracker.sqlite"
JOBTRACKER_APPLICATIONS_DIR="./applications"
JOBTRACKER_BASE_RESUME_PATH="./applications/private/base-resume.md"
JOBTRACKER_LINKEDIN_URL="https://www.linkedin.com/in/example"
```

Keep the base resume under the ignored applications directory or outside the repository. Provider diagnostics resolve the configured executable and invoke only `<executable> --version`. The drawer reports provider availability without exposing paths or diagnostic output. A provider must also already be authenticated before real work can succeed.

## Run locally

JobTracker requires Node.js 20.18.1 or newer.

Run the worker in one terminal:

```bash
npm run agent:worker
```

Run the web app in a second terminal:

```bash
npm run dev
```

Open the local URL printed by Next.js and choose the primary **Apply with Agent** action. Manual entry is the backup path for an application that was already submitted or does not need posting review and tailored materials. Enter one public HTTP or HTTPS job URL and select a provider. The flow is:

1. `queued_preview` — the API stored the request.
2. `previewing` — the worker validates the public URL, retrieves bounded posting context on the host, and performs a read-only, schema-constrained inspection.
3. `awaiting_approval` — review the company, role, location, summary, and posting state. No application record or materials exist yet.
4. Approve to enter `queued_execution`, or cancel to enter `cancelled` without execution.
5. `executing` — JobTracker upserts and verifies the tracker record, then asks the provider to create files.
6. `verifying` — JobTracker verifies file type, existence, canonical containment, registration output, and SQLite readback.
7. `succeeded` — the drawer shows the application and artifact links.

The drawer shows the current stage, a text-and-motion activity indicator, an elapsed timer, safe event timestamps, and formatted token usage when available. Preview stages are **Validating public job URL**, **Retrieving public job posting**, **Analyzing job posting**, and **Preview ready for approval**. Execution labels distinguish material creation from artifact verification.

The remaining terminal states are `failed`, `cancelled`, and `interrupted`. Cancellation is available while work is queued, awaiting approval, or active. Active and approval-pending runs remain available when the drawer closes. Terminal screens offer **Start another application**; closing a terminal screen resets the local drawer on its next open without deleting the historical run. If the worker stops during `previewing`, `executing`, or `verifying`, recovery marks abandoned work `interrupted`; it is never retried automatically.

## Posting retrieval and preview quality

JobTracker retrieves public posting content before invoking a provider. It manually revalidates every redirect, follows at most five redirects, uses a 15-second total deadline, accepts only HTML, XHTML, or plain text, and streams at most 2 MiB. HTML extraction uses Cheerio and removes scripts, styles, navigation, forms, and hidden content after separately reading valid `JobPosting` JSON-LD. Extracted, deduplicated plain text is limited to 32,000 Unicode characters.

The extracted posting and final public URL are transient untrusted prompt data. Raw HTML, response headers, cookies, network details, and extracted posting text are not stored in events or SQLite. Codex preview runs from a temporary directory with user configuration ignored, read-only sandboxing, an explicit schema and model, and no additional writable directory. Materials execution retains its existing project and applications-directory access so it can use `job-application-resume`.

Retrieval failure stops before provider invocation with `posting_retrieval_failed`. Preview quality is then grounded deterministically against the transient extracted context: normalized company and role must appear as whole phrases; login/error-page titles are rejected; and an extractive summary needs at least 3 unique non-stopword terms of at least 3 characters with matches for at least `max(3, ceil(60% of meaningful terms))`. The prompt requires posting-language responsibilities and forbids retrieval/access/login commentary. Unknown labels, error pages, hallucinated labels, and insufficiently grounded summaries stop with `preview_unusable`. Both failures show only approved safe guidance and never expose approval. Only a usable preview reaches `awaiting_approval`.

Artifact links use local routes such as `/api/applications/<application-id>/artifacts/<artifact-id>/file`. Files are served only after application ownership, registration, regular-file status, and configured-root containment are checked again.

## Verification and smoke tests

The fake-provider integration test uses a fresh temporary database, applications root, and synthetic resume. It invokes the real upsert and artifact registration scripts without contacting a provider:

```bash
npx vitest run src/lib/agent-workflow/integration.test.ts
```

Run a real Codex preview smoke without approving execution:

```bash
npm exec tsx scripts/smoke-agent-workflow.ts -- --provider codex --model gpt-5.6-terra --job-url https://example.com/public-job
```

The command stops at `awaiting_approval` and deletes all temporary state. Execution happens only when `--approve` is present:

```bash
npm exec tsx scripts/smoke-agent-workflow.ts -- --provider codex --model gpt-5.6-terra --job-url https://example.com/public-job --approve
```

Use a genuine public posting URL for provider testing. An approved smoke independently checks the application detail, every registered artifact and safe link, regular-file status, canonical containment, required fit analysis, and public event privacy. It prints structured preview/result summaries, not prompts, reasoning, raw CLI output, stderr, environment values, or private file paths.

All normal smoke stdout passes through one recursive sanitizer. It replaces every temporary root/database/applications/resume fragment, redacts recognized API keys, bearer credentials, passwords, secrets, and tokens, and removes control text before printing provider-derived company, role, location, summary, artifact titles, or other human-facing fields.

Add `--keep-temp` only when local debugging requires the temporary files. The command then prints the temporary root and leaves it on disk; delete it manually when finished.

`SIGINT` and `SIGTERM` abort active provider/worker operations. The harness then independently attempts both storage-cache closes, environment restoration, signal-handler removal, and temporary-root removal before exiting with the conventional nonzero signal status. Cleanup failures are reduced to one fixed safe message; raw cleanup errors are never printed. `--keep-temp` remains the only exception to temporary-root removal.

Claude uses the identical interface:

```bash
npm exec tsx scripts/smoke-agent-workflow.ts -- --provider claude --model sonnet --job-url https://example.com/public-job --approve
```

Claude smoke testing is optional at the controller stage and should run only when the Claude CLI is installed and authenticated. An unavailable or unauthenticated Claude installation is not a Codex workflow failure.

The real authenticated Codex smoke, optional authenticated Claude smoke, browser checks, ignore audit, and final review are controller release gates. Adding and testing this harness does not mark those external gates complete; they remain pending until the controller runs and records them.

## Security and privacy boundaries

- Only public HTTP/HTTPS URLs are accepted. Embedded credentials, localhost, loopback, private, link-local, reserved, or privately resolving hosts are rejected.
- Every redirect is manually revalidated before another request; retrieval uses no browser session, cookies, authentication state, or user credentials.
- Posting, profile, resume, and preview content is untrusted data. It cannot authorize submission, authentication, database writes, or command changes.
- Provider commands use fixed argument arrays and no shell interpolation.
- Preview is read-only. Execution writes only under `JOBTRACKER_APPLICATIONS_DIR`; JobTracker performs tracker mutations and artifact registration itself.
- Raw prompts, provider reasoning, tool arguments, raw stdout/stderr, environment values, credentials, and filesystem paths are not persisted in public events or returned links.
- A manifest is not proof. JobTracker requires real, canonical-contained regular files and exact SQLite registration readback before success.
- The workflow never submits an application or signs in on the user's behalf.

Before committing, confirm these remain ignored or outside the repository:

- `.env.local` and all provider authentication material
- `jobtracker.agent.local.json`
- `data/*.sqlite` and SQLite sidecar files
- `applications/*`, resumes, profile exports, and generated materials
- `.superpowers/` and other local orchestration state

Use `git status --short --ignored` to inspect the boundary.

## Troubleshooting

- **Provider executable is unavailable:** check the configured executable path, run the provider's `--version` command locally, and retry diagnostics. Do not add shell arguments to `executablePath`.
- **Agent provider configuration is invalid:** compare the ignored file with `jobtracker.agent.example.json`; both provider objects and only the two allowed fields are required.
- **Job URL could not be validated safely:** use a direct public HTTP/HTTPS posting URL whose DNS answers are public.
- **Preview or execution failed:** inspect the safe state and event messages in the drawer. Re-run the provider's normal authentication check outside JobTracker; raw provider errors are deliberately not displayed.
- **Run was interrupted:** restart `npm run agent:worker`, then start a new run. Interrupted work is not automatically retried.
- **Artifact verification failed:** with a disposable smoke run, repeat using `--keep-temp` and inspect the printed temporary root. Verify generated files are regular files below the applications root and use supported extensions/content types.
- **No work advances:** confirm both `npm run agent:worker` and `npm run dev` are running against the same `.env.local` database path.
