# Agent-First Application Workflow Design

## Objective

Make **Apply with Agent** the preferred way to create a JobTracker application while ensuring that previews are trustworthy, progress is visibly active, failed or terminal runs are restartable, and manual creation is clearly presented as the backup path for jobs the user has already applied to.

The workflow must never imply that using the agent guarantees employment outcomes. Product copy may say that it reviews the posting, prepares tailored materials, evaluates fit, and organizes the application workflow.

## Problems to solve

1. A preview can spend tens of seconds and substantial tokens while the drawer appears frozen.
2. Codex receives only a URL and has no deterministic posting-retrieval boundary. A publicly retrievable LinkedIn page produced `Unknown` company and role after more than 200,000 input tokens.
3. Structurally valid but semantically unusable previews still reach `awaiting_approval` and show **Approve and create materials**.
4. A cancelled or otherwise terminal run remains in React state after the drawer closes, leaving no route back to the URL form without a full-page reload.
5. The dashboard visually presents manual creation as the normal path even though the agent workflow should be primary.

## Product decisions

### Agent-first hierarchy

The dashboard must use the following hierarchy in both empty and populated states:

- Primary action: **Apply with Agent**.
- Secondary action: **Already applied? Add it manually** in the empty state and **Add existing application** in the populated header.
- The manual application page remains available and unchanged functionally, but its entry points describe it as the path for an application that has already been submitted or otherwise does not need posting review and tailored-material generation.

The empty state must use this message:

- Heading: **Start your next application**
- Body: **Give the agent a public job posting. Review the role before it creates tailored materials and adds the application to your tracker.**
- Primary button: **Apply with Agent**
- Secondary link: **Already applied? Add it manually**

Visual priority must be communicated with order, size, button treatment, and accessible names rather than color alone.

### Host-controlled posting retrieval

JobTracker, not the model, retrieves the posting during `previewing`.

Create a focused server/worker module with an injectable fetch dependency. It must:

- accept only a URL that has passed the existing public-job URL validation;
- revalidate every redirect destination with the same scheme, credential, hostname, DNS, loopback, localhost, and private-address rules;
- follow at most 5 redirects using manual redirect handling;
- use no browser cookies, authentication state, credentials, or user secrets;
- identify itself with `JobTracker/0.1 local-agent-preview`;
- use a 15-second total abort timeout;
- accept only `text/html`, `application/xhtml+xml`, or `text/plain` responses;
- stream at most 2 MiB of response bytes and abort before buffering more;
- reject non-2xx responses, invalid redirects, unsupported content, empty content, timeout, and size overflow with stable safe error codes;
- parse HTML with a direct production dependency on `cheerio`;
- extract document title, description and Open Graph metadata, canonical URL, `JobPosting` JSON-LD fields, and readable body text after removing script, style, navigation, form, and hidden content;
- collapse whitespace, deduplicate repeated sections, and produce at most 32,000 UTF-8 characters of untrusted plain-text context;
- never persist raw HTML, response headers, cookies, resolved addresses, private paths, or unsanitized network errors.

The retrieved context is transient. Persisted events may contain only the safe stage messages defined below.

### Provider isolation and preview quality

Extend the typed preview request with the bounded retrieved posting context. The preview prompt must include the final public URL and the extracted text inside an explicit untrusted-data delimiter.

Codex preview must run from its temporary directory instead of the JobTracker project root and must use `--ignore-user-config`. Authentication still comes from `CODEX_HOME`; the model and schema remain explicit. The preview invocation must not gain workspace access, browser cookies, MCP servers, or write access. Materials invocation remains unchanged because it needs the installed `job-application-resume` skill and applications directory.

After schema parsing, a preview is usable only when:

- `company.trim()` and `role.trim()` are nonempty;
- neither normalized value is `unknown`, `unavailable`, `not found`, `n/a`, or `null`;
- the normalized role is not a common non-job page title: `sign in`, `login`, `log in`, `access denied`, or `page not found`;
- the host retrieval produced nonempty bounded context;
- NFKC-normalized, lowercased company and role phrases, with non-alphanumeric runs collapsed to spaces, each occur as whole normalized phrases in the retrieved context;
- `summary.trim()` is nonempty and contains at least 3 unique meaningful normalized terms of at least 3 characters after excluding the explicit stopword set `a, an, and, are, as, at, be, by, for, from, in, into, is, it, of, on, or, that, the, their, this, to, with, you, your`;
- retrieved context contains at least `max(3, ceil(0.60 * meaningful summary terms))` of those unique meaningful terms.

The provider prompt must request an extractive responsibility summary using posting language and must prohibit retrieval, access, login, or missing-content commentary. This deterministic grounding contract replaces natural-language retrieval-fallback heuristics: legitimate retrieval-systems roles pass when their labels and responsibility language are evidenced in context, while login pages, error pages, hallucinated labels, and ungrounded paraphrases fail.

An unusable preview must transition from `previewing` to `failed` with failure code `preview_unusable` and safe message **The job posting could not be identified reliably. Try another public posting URL.** It must never enter `awaiting_approval` and must never expose the approval action.

Retrieval failures use failure code `posting_retrieval_failed` and safe message **The public job posting could not be retrieved safely. Check the link or try another public posting URL.** Provider failures retain their existing safe classifications.

### Visible activity and usage

Persist these safe host-generated progress messages as the preview moves through its boundaries:

1. **Validating public job URL.**
2. **Retrieving public job posting.**
3. **Analyzing job posting.**
4. **Preview ready for approval.** only after the quality gate succeeds.

Execution continues to use its existing safe events and adds clear stage labels for creating materials and verifying artifacts when those states are active.

While a run is in `queued_preview`, `previewing`, `queued_execution`, `executing`, or `verifying`, the drawer must show:

- an animated activity indicator;
- a human-readable current-stage heading;
- **Working…** and a client-side elapsed timer formatted as `m:ss`;
- the safe event timeline with timestamps;
- actual formatted token counts whenever usage is available.

Animation must stop under `prefers-reduced-motion: reduce`, while text and elapsed time continue to communicate activity. The browser must not poll after `awaiting_approval` or a terminal state, and UI timers must be cleared on close and unmount.

Replace the generic **Provider usage update.** presentation with a usage summary such as **208,992 input · 1,241 output · 150,784 cached**. Do not display absent values as zero.

### Recovery and restart

Active and approval-pending runs are preserved when the drawer closes, allowing the user to reopen and continue them.

For `cancelled`, `failed`, `interrupted`, and `succeeded`:

- show a **Start another application** action;
- reset `run`, URL, model override, error, pending action, elapsed timer, requests, and polling when that action is selected;
- retain loaded provider diagnostics and the selected available provider;
- closing the drawer marks the terminal view for reset, so the next opening starts at the fresh URL form;
- a successful run keeps its application and artifact links visible until the user closes it or selects **Start another application**.

The reset is local UI state only. It must not delete or mutate the historical run in SQLite.

### Failure presentation

Failed retrieval and unusable-preview states must display the safe failure message, the submitted public URL hostname, **Try another URL**, and **Cancel/Close** as appropriate. They must not display an approval button or raw provider/network output.

## Architecture and data flow

1. The API validates and enqueues the canonical URL as it does today.
2. The worker claims `queued_preview`, records **Validating public job URL.**, and revalidates the stored canonical URL.
3. The worker records **Retrieving public job posting.** and calls the bounded host retriever.
4. On retrieval failure, the worker fails safely without invoking a model.
5. The worker records **Analyzing job posting.** and calls the selected provider with transient extracted context.
6. The provider runs in its constrained preview environment and returns the schema object.
7. The worker applies the semantic preview-quality gate.
8. Only a usable preview reaches `awaiting_approval`.
9. Approval, deterministic upsert, materials creation, artifact verification, and registration continue through the existing host-controlled pipeline.

## Testing contract

Use strict red-green TDD.

### Retrieval tests

- successful LinkedIn-like guest HTML extracts company, role, description, canonical URL, and bounded readable text;
- plain text succeeds;
- every redirect is revalidated;
- credentials, private/loopback/localhost redirects, redirect loops, more than 5 redirects, timeout, non-2xx, unsupported content type, empty response, and more than 2 MiB fail safely;
- raw HTML, cookies, headers, addresses, and raw errors never appear in persisted events or public run output.

### Provider and orchestration tests

- preview prompt contains bounded extracted context and final URL as untrusted data;
- Codex preview uses a temporary cwd and `--ignore-user-config` while materials behavior remains unchanged;
- retrieval failure never invokes the provider;
- unusable `Unknown` previews become `failed/preview_unusable`;
- only usable previews reach approval;
- stage events are ordered and sanitized;
- usage fields remain numeric and public-safe.

### UI tests

- active runs show stage, activity indicator, elapsed time, timestamps, and formatted usage;
- reduced motion disables animation without removing status text;
- retrieval/unusable failures never render approval;
- cancelled/failed/interrupted/succeeded runs render **Start another application**;
- cancel → close → reopen renders a fresh URL form;
- close/reopen during an active or approval-pending run preserves that run;
- starting another run resets local state without deleting history;
- empty and populated dashboards make **Apply with Agent** primary and manual creation secondary;
- desktop and mobile layouts preserve the hierarchy and have no horizontal overflow.

### Final verification

- focused retrieval, provider, orchestrator, API, drawer, and dashboard tests;
- `npm run verify`;
- `npm run build`;
- fake-provider integration proving retrieval context and quality gating;
- desktop and mobile browser checks of activity, safe failure, restart, and agent-first dashboard hierarchy;
- private and generated files remain ignored and uncommitted.

No real model smoke is required for this corrective iteration unless a provider contract changes in a way that focused invocation tests cannot prove. Do not push or open a pull request.
