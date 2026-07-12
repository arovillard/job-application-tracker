# Opportunity and Connection Lead System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the application-only tracker with a unified opportunity workspace for jobs and human connections while preserving all existing application history and materials.

**Architecture:** Keep SQLite and the local-first Next.js architecture. Introduce a shared `opportunities` parent with normalized job and connection detail tables, one append-only activity stream, first-class tasks, and opportunity-scoped artifacts. Existing application records migrate transactionally and retain their IDs; the UI and APIs then move to opportunity-oriented contracts.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, `better-sqlite3`, Zod 4, Vitest 4, React Markdown, React PDF.

## Global Constraints

- Opportunity types are exactly `job` and `connection`.
- Job statuses remain exactly `wishlist`, `applied`, `interviewing`, `offer`, `rejected`, and `archived` in this release.
- Connection statuses are exactly `new`, `outreach_planned`, `waiting`, `in_conversation`, `opportunity_identified`, `dormant`, `closed`, and `archived`.
- Connection relationship strengths are exactly `new`, `familiar`, and `strong`.
- Migrated applications retain their existing IDs, timestamps, statuses, notes, status history, follow-ups, next actions, and artifact links.
- Existing application tables remain as read-only rollback evidence for the first release.
- All multi-record writes and the legacy migration are SQLite transactions.
- Dates remain date-only `YYYY-MM-DD` values; event timestamps remain ISO strings.
- Artifacts remain file-backed and are valid only for job opportunities.
- `originOpportunityId` may reference only an existing, non-archived connection.
- Existing `/applications/:id` browser links redirect to `/opportunities/:id`.
- Public posting intake continues to deduplicate jobs by normalized organization plus role.
- Do not add email, calendar, LinkedIn, address-book, scoring, kanban, or graph integrations.
- Preserve the current restrained visual language and responsive desktop/mobile behavior.

---

## File Structure

### Domain and persistence

- `src/types.ts`: canonical opportunity, activity, task, artifact, filter, and API input types.
- `src/lib/opportunity-migration.ts`: table creation and idempotent application-to-opportunity migration only.
- `src/lib/storage.ts`: database lifecycle and opportunity CRUD, activity, task, linking, and artifact operations.
- `src/lib/storage.test.ts`: storage and migration contract tests.
- `src/lib/dashboard.ts`: attention and broad-status calculations over opportunity summaries and tasks.
- `src/lib/dashboard.test.ts`: dashboard rule tests for mixed opportunity types.

### API

- `src/app/api/opportunities/route.ts`: list and create.
- `src/app/api/opportunities/[id]/route.ts`: detail, update, and permanent delete.
- `src/app/api/opportunities/[id]/status/route.ts`: type-aware status transition.
- `src/app/api/opportunities/[id]/activities/route.ts`: activity creation with optional task.
- `src/app/api/opportunities/[id]/tasks/route.ts`: task creation.
- `src/app/api/opportunities/[id]/tasks/[taskId]/route.ts`: complete, cancel, reopen, and reschedule.
- `src/app/api/opportunities/[id]/jobs/route.ts`: create a linked job from a connection.
- `src/app/api/opportunities/[id]/artifacts/[artifactId]/file/route.ts`: serve job artifacts.
- `src/app/api/opportunities/api.test.ts`: direct route-handler contract tests.

### UI

- `src/components/Dashboard.tsx`: opportunity workspace state and data loading.
- `src/components/OpportunityTable.tsx`: mixed job/connection desktop table and mobile cards.
- `src/components/OpportunityTypeFilter.tsx`: all/job/connection filter.
- `src/components/StatusFilter.tsx`: broad and type-specific status filter.
- `src/components/AttentionQueue.tsx`: opportunity task attention strip.
- `src/components/NewOpportunityPage.tsx`: type chooser and create orchestration.
- `src/components/JobOpportunityForm.tsx`: job fields.
- `src/components/ConnectionOpportunityForm.tsx`: connection fields, initial note, and optional next action.
- `src/components/OpportunityDetailPage.tsx`: shared detail shell and type-specific sections.
- `src/components/OpportunityActivityTimeline.tsx`: activity rendering.
- `src/components/OpportunityTaskList.tsx`: task create, complete, cancel, reopen, and reschedule controls.
- `src/components/OpportunityArtifactViewer.tsx`: job artifact rendering with opportunity routes.
- `src/components/Dashboard.test.tsx`: mixed-workspace component tests.
- `src/components/NewOpportunityPage.test.tsx`: type chooser and payload tests.
- `src/components/OpportunityDetailPage.test.tsx`: detail, activity, task, and linking tests.
- `src/app/opportunities/new/page.tsx`: new-opportunity route.
- `src/app/opportunities/[id]/page.tsx`: opportunity-detail route.
- `src/app/applications/new/page.tsx`: compatibility redirect.
- `src/app/applications/[id]/page.tsx`: ID-preserving compatibility redirect.
- `src/app/globals.css`: opportunity badges, mixed rows/cards, task list, and responsive form/detail styles.

### Agent workflow and documentation

- `scripts/upsert-job-posting.mjs`: upsert job opportunities and emit canonical opportunity JSON.
- `scripts/upsert-job-posting.test.ts`: new schema, duplicate, migration, and alias tests.
- `scripts/register-application-artifact.mjs`: resolve and register job-opportunity artifacts.
- `scripts/register-application-artifact.test.ts`: job-only artifact tests.
- `scripts/backfill-application-artifacts.mjs`: backfill files against job opportunities.
- `scripts/backfill-application-artifacts.test.ts`: new-schema backfill tests.
- `skills/job-tracker-add-posting/SKILL.md`: opportunity intake language and output checks.
- `skills/job-tracker-add-posting/references/schema.md`: opportunity schema reference.
- `skills/job-application-resume/SKILL.md`: job-opportunity artifact registration language.
- `.claude/skills/job-tracker-add-posting/SKILL.md`: synchronized Claude workflow.
- `.claude/skills/job-application-resume/SKILL.md`: synchronized Claude workflow.
- `README.md`: opportunity product and migration documentation.
- `docs/agent-setup.md`: setup and intake workflow terminology.
- `CHANGELOG.md`: user-visible migration and lead-management feature.

### Removed after replacements exist

- `src/components/ApplicationTable.tsx`
- `src/components/ApplicationForm.tsx`
- `src/components/NewApplicationPage.tsx`
- `src/components/ApplicationDetailPage.tsx`
- `src/components/ActivityTimeline.tsx`
- `src/components/ApplicationArtifactViewer.tsx`
- `src/app/api/applications/route.ts`
- `src/app/api/applications/[id]/route.ts`
- `src/app/api/applications/[id]/notes/route.ts`
- `src/app/api/applications/[id]/status/route.ts`
- `src/app/api/applications/[id]/artifacts/[artifactId]/file/route.ts`
- `src/app/api/followups/route.ts`

---

### Task 1: Opportunity Domain, Schema, and Legacy Migration

**Risk:** High. This task changes the source of truth and must preserve private user data.

**Dependencies:** None.

**Files:**

- Modify: `src/types.ts`
- Create: `src/lib/opportunity-migration.ts`
- Modify: `src/lib/storage.ts`
- Modify: `src/lib/storage.test.ts`

**Interfaces:**

- Produces: `Opportunity`, `OpportunitySummary`, `OpportunityDetail`, `OpportunityInput`, `OpportunityActivity`, `OpportunityTask`, `OpportunityArtifact`, `OpportunityFilters`.
- Produces: `listOpportunities`, `getOpportunityDetail`, `createOpportunity`, `updateOpportunity`, `deleteOpportunity`, `changeOpportunityStatus`, `addOpportunityActivity`, `createOpportunityTask`, `updateOpportunityTask`, `createLinkedJobOpportunity`, `upsertOpportunityArtifact`.
- Produces: `ensureOpportunitySchema(db)` and `migrateLegacyApplications(db)` for storage initialization.

- [ ] **Step 1: Add failing type and fresh-database storage tests**

Add tests that create one record of each type and assert subtype fields are isolated:

```ts
it("creates job and connection opportunities with type-specific details", () => {
  const job = createOpportunity({
    type: "job",
    label: "Engineering Manager",
    organization: "Acme",
    status: "wishlist",
    priority: "high",
    summary: "Platform leadership role",
    url: "https://example.com/job",
    source: "Acme careers",
    location: "Example City",
    contact: "Maya Chen",
    appliedDate: null,
    originOpportunityId: null
  });
  const connection = createOpportunity({
    type: "connection",
    label: "Maya Chen",
    organization: "Acme",
    status: "new",
    priority: "medium",
    summary: "Met at the platform leadership meetup",
    roleContext: "VP Engineering",
    contactInfo: "maya@example.com",
    meetingContext: "Example City engineering meetup",
    relationshipStrength: "familiar"
  });

  expect(job).toMatchObject({ type: "job", label: "Engineering Manager", url: "https://example.com/job" });
  expect(connection).toMatchObject({ type: "connection", label: "Maya Chen", relationshipStrength: "familiar" });
  expect(listOpportunities()).toHaveLength(2);
});
```

- [ ] **Step 2: Add failing migration tests**

Create a legacy SQLite database using the current `applications`, `application_notes`, `application_status_changes`, and `application_artifacts` DDL. Seed one application with a typed follow-up, next action, status history, and artifact. Reopen storage and assert:

```ts
expect(detail).toMatchObject({
  id: "legacy-application",
  type: "job",
  label: "Engineering Manager",
  organization: "Legacy Co",
  status: "interviewing"
});
expect(detail?.activities.map((activity) => activity.type)).toEqual([
  "opportunity_created",
  "status_change",
  "note",
  "status_change"
]);
expect(detail?.tasks).toEqual(expect.arrayContaining([
  expect.objectContaining({ title: "Send portfolio", dueDate: "2026-07-15", state: "open" }),
  expect.objectContaining({ title: "Follow up with recruiter", dueDate: "2026-07-18", state: "open" })
]));
expect(detail?.artifacts[0]).toMatchObject({ id: "legacy-artifact", type: "resume" });
```

Run migration initialization twice and assert the second pass creates no duplicate opportunities, activities, tasks, or artifacts.

- [ ] **Step 3: Run the focused tests and confirm the missing-interface failure**

Run:

```bash
npm test -- src/lib/storage.test.ts
```

Expected: FAIL because the opportunity types and storage exports do not exist.

- [ ] **Step 4: Replace application types with the opportunity contract**

Define literal sets and a discriminated union in `src/types.ts`:

```ts
export const OPPORTUNITY_TYPES = ["job", "connection"] as const;
export const JOB_STATUSES = ["wishlist", "applied", "interviewing", "offer", "rejected", "archived"] as const;
export const CONNECTION_STATUSES = [
  "new", "outreach_planned", "waiting", "in_conversation",
  "opportunity_identified", "dormant", "closed", "archived"
] as const;
export const RELATIONSHIP_STRENGTHS = ["new", "familiar", "strong"] as const;
export const OPPORTUNITY_PRIORITIES = ["low", "medium", "high"] as const;
export const OPPORTUNITY_ACTIVITY_TYPES = [
  "note", "meeting", "call", "email", "message", "introduction",
  "status_change", "task_created", "task_completed", "task_cancelled",
  "task_rescheduled", "opportunity_created", "linked_job_created"
] as const;
export const OPPORTUNITY_TASK_STATES = ["open", "completed", "cancelled"] as const;
```

Use `OpportunityBase` plus `JobOpportunity` and `ConnectionOpportunity` branches. Define `OpportunityInput` as the matching input union and make `OpportunityDetail` contain `activities`, `tasks`, `artifacts`, nullable `origin`, and `originatedJobs`.

- [ ] **Step 5: Add the normalized schema and idempotent migration**

In `src/lib/opportunity-migration.ts`, create the new tables and indexes:

```sql
CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  organization TEXT,
  status TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  summary TEXT,
  origin_opportunity_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (origin_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS job_opportunity_details (
  opportunity_id TEXT PRIMARY KEY,
  url TEXT,
  source TEXT,
  location TEXT,
  contact TEXT,
  applied_date TEXT,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS connection_opportunity_details (
  opportunity_id TEXT PRIMARY KEY,
  role_context TEXT,
  contact_info TEXT,
  meeting_context TEXT,
  relationship_strength TEXT NOT NULL DEFAULT 'new',
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS opportunity_activities (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata_json TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS opportunity_tasks (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT,
  state TEXT NOT NULL,
  source_activity_id TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
  FOREIGN KEY (source_activity_id) REFERENCES opportunity_activities(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS opportunity_artifacts (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text/markdown',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(opportunity_id, type, file_path),
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schema_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Use a single `db.transaction()` to copy legacy rows. Preserve application IDs. Insert migration marker `opportunity_schema_version = 1` last. Normalize title/date pairs before deduplicating migrated next actions and follow-ups.

- [ ] **Step 6: Implement opportunity storage and validation**

Keep connection opening and test reset behavior in `src/lib/storage.ts`. Replace application projections with a shared projection joined to the matching subtype table. Validate input using literal sets and reject subtype-field leakage.

Expose these exact signatures:

```ts
export function listOpportunities(filters: OpportunityFilters = {}): OpportunitySummary[];
export function getOpportunityDetail(id: string): OpportunityDetail | null;
export function createOpportunity(
  input: OpportunityInput,
  initial?: { activity?: OpportunityActivityInput | null; task?: OpportunityTaskInput | null }
): OpportunityDetail;
export function updateOpportunity(id: string, input: OpportunityInput): OpportunityDetail | null;
export function deleteOpportunity(id: string): boolean;
export function changeOpportunityStatus(id: string, status: OpportunityStatus, note?: string | null): OpportunityDetail;
export function addOpportunityActivity(
  id: string,
  input: OpportunityActivityInput,
  task?: OpportunityTaskInput | null
): OpportunityDetail;
export function createOpportunityTask(id: string, input: OpportunityTaskInput): OpportunityDetail;
export function updateOpportunityTask(id: string, taskId: string, input: OpportunityTaskUpdateInput): OpportunityDetail;
export function createLinkedJobOpportunity(connectionId: string, input: JobOpportunityInput): OpportunityDetail;
export function upsertOpportunityArtifact(id: string, input: OpportunityArtifactInput): OpportunityArtifact;
```

Every status change, task creation, task completion, task cancellation, and reschedule writes its system activity in the same transaction.

- [ ] **Step 7: Run storage tests**

Run:

```bash
npm test -- src/lib/storage.test.ts
```

Expected: PASS with fresh-schema, migration, rollback, idempotency, validation, activity, task, linking, and artifact cases green.

- [ ] **Step 8: Commit the persistence foundation**

```bash
git add src/types.ts src/lib/opportunity-migration.ts src/lib/storage.ts src/lib/storage.test.ts
git commit -m "feat: add opportunity domain and migration"
```

---

### Task 2: Opportunity API Contracts

**Risk:** Medium. Route validation must match storage validation and return stable error codes.

**Dependencies:** Task 1.

**Files:**

- Create: `src/app/api/opportunities/route.ts`
- Create: `src/app/api/opportunities/[id]/route.ts`
- Create: `src/app/api/opportunities/[id]/status/route.ts`
- Create: `src/app/api/opportunities/[id]/activities/route.ts`
- Create: `src/app/api/opportunities/[id]/tasks/route.ts`
- Create: `src/app/api/opportunities/[id]/tasks/[taskId]/route.ts`
- Create: `src/app/api/opportunities/[id]/jobs/route.ts`
- Create: `src/app/api/opportunities/api.test.ts`

**Interfaces:**

- Consumes: Task 1 storage exports and `OpportunityInput` types.
- Produces: JSON endpoints specified in the approved design.

- [ ] **Step 1: Write failing route-handler tests**

Call exported route handlers directly with `Request` objects. Cover:

```ts
const createResponse = await POST(new Request("http://localhost/api/opportunities", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(connectionInput)
}));
expect(createResponse.status).toBe(201);

const invalidStatusResponse = await PATCH_STATUS(
  jsonRequest({ status: "interviewing" }, "PATCH"),
  context(created.id)
);
expect(invalidStatusResponse.status).toBe(400);
expect(await invalidStatusResponse.json()).toEqual({ error: "Status is invalid for a connection opportunity" });
```

Also test missing records return `404`, cross-opportunity task IDs return `400`, and linked-job creation rejects job origins and archived connections.

- [ ] **Step 2: Run the API test and confirm route modules are missing**

```bash
npm test -- src/app/api/opportunities/api.test.ts
```

Expected: FAIL with unresolved opportunity route imports.

- [ ] **Step 3: Add shared route error mapping**

Keep a small local helper in `src/app/api/opportunities/route.ts` and export it for nested routes:

```ts
export function opportunityErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  const status = /not found/i.test(message) ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}
```

Do not catch migration/startup errors as ordinary `400` responses; let them surface as server failures.

- [ ] **Step 4: Implement list and create routes**

`GET` accepts `type=all|job|connection`, `status`, `search`, and `archived=include|exclude|only`. `POST` accepts one transactional creation envelope and returns `201`:

```ts
type CreateOpportunityBody = {
  opportunity: OpportunityInput;
  initialActivity?: OpportunityActivityInput | null;
  initialTask?: OpportunityTaskInput | null;
};
```

Call `createOpportunity(body.opportunity, { activity: body.initialActivity, task: body.initialTask })` so no initial child record can be partially persisted.

```ts
export function GET(request: Request) {
  const url = new URL(request.url);
  return NextResponse.json(listOpportunities({
    type: parseType(url.searchParams.get("type")),
    status: parseStatus(url.searchParams.get("status")),
    search: url.searchParams.get("search") ?? undefined,
    archived: parseArchived(url.searchParams.get("archived"))
  }));
}
```

- [ ] **Step 5: Implement detail, status, activity, task, and linking routes**

Use `PUT` for complete detail replacement, `PATCH` for state transitions, and `POST` for append/create operations. Return complete `OpportunityDetail` after mutations so client state can replace atomically.

The activity payload is:

```ts
type CreateActivityBody = OpportunityActivityInput & {
  task?: OpportunityTaskInput | null;
};
```

Pass activity plus optional task to one transactional storage operation rather than issuing two writes from the route.

- [ ] **Step 6: Run API tests**

```bash
npm test -- src/app/api/opportunities/api.test.ts
```

Expected: PASS for create, list filters, detail, status, activities, tasks, and linked jobs.

- [ ] **Step 7: Commit the API layer**

```bash
git add src/app/api/opportunities
git commit -m "feat: add opportunity APIs"
```

---

### Task 3: Unified Dashboard and Attention Queue

**Risk:** Medium. Mixed types introduce incompatible statuses and presentation fields.

**Dependencies:** Tasks 1 and 2.

**Files:**

- Modify: `src/lib/dashboard.ts`
- Modify: `src/lib/dashboard.test.ts`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/Dashboard.test.tsx`
- Create: `src/components/OpportunityTable.tsx`
- Create: `src/components/OpportunityTypeFilter.tsx`
- Modify: `src/components/StatusFilter.tsx`
- Modify: `src/components/AttentionQueue.tsx`
- Modify: `src/app/globals.css`
- Delete: `src/components/ApplicationTable.tsx`

**Interfaces:**

- Consumes: `GET /api/opportunities` and opportunity summary types.
- Produces: `getDashboardInsights(opportunities, currentDate)` and type-aware dashboard controls.

- [ ] **Step 1: Replace dashboard fixtures with mixed opportunities and failing attention tests**

Assert due tasks sort before missing actions, future tasks suppress missing-action warnings, and dormant/closed/archived connections are excluded:

```ts
expect(insights.attention.map((item) => [item.opportunityId, item.kind])).toEqual([
  ["connection-due", "task"],
  ["job-due", "task"],
  ["connection-new", "missing_next_action"]
]);
```

Add a component rendering test that expects `Jobs`, `Connections`, a type badge for each row, and no application-only empty-state copy.

- [ ] **Step 2: Run focused dashboard tests and confirm failures**

```bash
npm test -- src/lib/dashboard.test.ts src/components/Dashboard.test.tsx
```

Expected: FAIL because dashboard functions still consume applications and follow-ups.

- [ ] **Step 3: Rebuild dashboard insight calculation around open tasks**

Use one input collection. A summary contains `nextTask`; detail task lists are not required for dashboard loading.

```ts
const CONNECTION_FORWARD_STATUSES = new Set([
  "new", "outreach_planned", "waiting", "in_conversation", "opportunity_identified"
]);
const JOB_FORWARD_STATUSES = new Set(["applied", "interviewing", "offer"]);
```

Emit `kind: "task"` when `nextTask.dueDate <= today`, and `kind: "missing_next_action"` only when the record is forward-moving and has no open task.

- [ ] **Step 4: Implement type and status filters**

`OpportunityTypeFilter` exposes `all`, `job`, and `connection`. `StatusFilter` accepts a generated option list rather than importing application constants:

```ts
type StatusFilterOption = { value: string; label: string; count?: number };
type StatusFilterProps = {
  value: string;
  options: StatusFilterOption[];
  onChange: (value: string) => void;
};
```

For `all`, options are `active`, `attention`, `closed`, and `archived`. For a single type, use exact type statuses plus `all`.

- [ ] **Step 5: Build the mixed OpportunityTable**

Render type-specific identities without nullable-field branching outside the discriminated union:

```tsx
<span className={`type-badge type-badge--${opportunity.type}`}>
  {opportunity.type === "job" ? "Job" : "Connection"}
</span>
<span className="application-table__primary">{opportunity.label}</span>
<span className="application-table__secondary">
  {opportunity.organization ?? (opportunity.type === "connection" ? opportunity.roleContext : "Organization not set")}
</span>
```

Use `/opportunities/${id}` links and `New opportunity` empty-state copy.

- [ ] **Step 6: Convert Dashboard data loading and filtering**

Replace the two existing application/follow-up fetches with one `GET /api/opportunities`. Keep optimistic status updates, but send them to `/api/opportunities/:id/status`. Search locally over the returned fields and preserve current sorting controls.

- [ ] **Step 7: Add responsive opportunity styles**

Extend existing CSS variables and table/card patterns with:

```css
.type-badge--job { background: var(--status-blue-soft); color: var(--status-blue); }
.type-badge--connection { background: var(--status-green-soft); color: var(--status-green); }
.opportunity-type-filter { display: inline-flex; gap: 0.375rem; }
.relationship-chip { border: 1px solid var(--border); border-radius: 999px; padding: 0.2rem 0.55rem; }
```

At the existing mobile breakpoint, keep type, identity, next action, status, and priority visible in card order.

- [ ] **Step 8: Run dashboard tests**

```bash
npm test -- src/lib/dashboard.test.ts src/components/Dashboard.test.tsx
```

Expected: PASS for mixed rendering, filters, and attention behavior.

- [ ] **Step 9: Commit the opportunity workspace**

```bash
git add src/lib/dashboard.ts src/lib/dashboard.test.ts src/components/Dashboard.tsx src/components/Dashboard.test.tsx src/components/OpportunityTable.tsx src/components/OpportunityTypeFilter.tsx src/components/StatusFilter.tsx src/components/AttentionQueue.tsx src/app/globals.css
git rm src/components/ApplicationTable.tsx
git commit -m "feat: unify jobs and connections dashboard"
```

---

### Task 4: Type-Aware Opportunity Creation

**Risk:** Low. This is additive once API contracts are stable.

**Dependencies:** Task 2.

**Files:**

- Create: `src/components/NewOpportunityPage.tsx`
- Create: `src/components/NewOpportunityPage.test.tsx`
- Create: `src/components/JobOpportunityForm.tsx`
- Create: `src/components/ConnectionOpportunityForm.tsx`
- Create: `src/app/opportunities/new/page.tsx`
- Modify: `src/app/applications/new/page.tsx`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/app/globals.css`
- Delete: `src/components/NewApplicationPage.tsx`
- Delete: `src/components/ApplicationForm.tsx`

**Interfaces:**

- Consumes: `POST /api/opportunities`.
- Produces: a two-step type chooser and exact `JobOpportunityInput` or `ConnectionOpportunityInput` payload.

- [ ] **Step 1: Write failing type-chooser and payload tests**

Render with server markup for static content and use jsdom event tests for payload creation. Assert:

```ts
expect(markup).toContain("What kind of opportunity are you adding?");
expect(markup).toContain("Job posting");
expect(markup).toContain("Connection");
```

For a connection submission, assert the body includes `type: "connection"`, `relationshipStrength: "new"`, `status: "new"`, optional initial activity, and optional task. Assert no job-only fields are sent.

- [ ] **Step 2: Run the focused test and confirm missing components**

```bash
npm test -- src/components/NewOpportunityPage.test.tsx
```

Expected: FAIL with unresolved new-opportunity component imports.

- [ ] **Step 3: Build the type chooser**

Use two clear option buttons, not a select:

```tsx
<button type="button" onClick={() => setType("job")}>
  <strong>Job posting</strong>
  <span>Track a role from discovery through outcome.</span>
</button>
<button type="button" onClick={() => setType("connection")}>
  <strong>Connection</strong>
  <span>Track a person, conversation, and future follow-up.</span>
</button>
```

Allow returning to the chooser before submission.

- [ ] **Step 4: Extract the job form from ApplicationForm**

Rename fields to opportunity language but retain current validation and defaults. `JobOpportunityForm` accepts:

```ts
type JobOpportunityFormProps = {
  initialValue?: JobOpportunity | JobOpportunityInput | null;
  originOpportunityId?: string | null;
  onSubmit: (input: JobOpportunityInput) => void | Promise<void>;
  isSubmitting?: boolean;
  submitLabel?: string;
};
```

- [ ] **Step 5: Implement the rapid connection form**

Fields are person name, organization, role/context, meeting context, contact information, summary, relationship strength, status, priority, initial activity body/type/date, task title, and task due date. Only person name is required.

Build the create request as:

```ts
{
  opportunity: connectionInput,
  initialActivity: activityBody.trim() ? {
    type: activityType,
    body: activityBody,
    occurredAt: activityDate ? `${activityDate}T12:00:00.000Z` : new Date().toISOString()
  } : null,
  initialTask: taskTitle.trim() ? { title: taskTitle, dueDate: taskDueDate || null } : null
}
```

- [ ] **Step 6: Add routes and compatibility redirect**

Create `/opportunities/new`. Replace the old new-application component route with:

```ts
import { redirect } from "next/navigation";

export default function LegacyNewApplicationRoute() {
  redirect("/opportunities/new?type=job");
}
```

Update every dashboard creation link and keyboard shortcut to `/opportunities/new`.

- [ ] **Step 7: Run creation tests**

```bash
npm test -- src/components/NewOpportunityPage.test.tsx src/components/Dashboard.test.tsx
```

Expected: PASS for chooser copy, payload isolation, redirects, and creation links.

- [ ] **Step 8: Commit the creation flow**

```bash
git add src/components/NewOpportunityPage.tsx src/components/NewOpportunityPage.test.tsx src/components/JobOpportunityForm.tsx src/components/ConnectionOpportunityForm.tsx src/app/opportunities/new/page.tsx src/app/applications/new/page.tsx src/components/Dashboard.tsx src/app/globals.css
git rm src/components/NewApplicationPage.tsx src/components/ApplicationForm.tsx
git commit -m "feat: add job and connection capture"
```

---

### Task 5: Shared Detail, Activity History, and Tasks

**Risk:** Medium. Several mutations must keep client state and the append-only timeline consistent.

**Dependencies:** Tasks 2 and 4.

**Files:**

- Create: `src/components/OpportunityDetailPage.tsx`
- Create: `src/components/OpportunityDetailPage.test.tsx`
- Create: `src/components/OpportunityActivityTimeline.tsx`
- Create: `src/components/OpportunityTaskList.tsx`
- Create: `src/app/opportunities/[id]/page.tsx`
- Modify: `src/app/globals.css`
- Delete: `src/components/ApplicationDetailPage.tsx`
- Delete: `src/components/ActivityTimeline.tsx`

**Interfaces:**

- Consumes: detail, update, status, activity, and task APIs from Task 2.
- Produces: one detail shell with job and connection sections.

- [ ] **Step 1: Write failing detail rendering and mutation tests**

Cover job and connection headers, relationship strength, task controls, activity labels, edit payloads, status transitions, and error notices.

```ts
expect(connectionMarkup).toContain("Connection");
expect(connectionMarkup).toContain("Maya Chen");
expect(connectionMarkup).toContain("Familiar");
expect(connectionMarkup).toContain("Record interaction");
expect(jobMarkup).toContain("Application materials");
expect(jobMarkup).not.toContain("Relationship strength");
```

- [ ] **Step 2: Run the focused test and confirm missing components**

```bash
npm test -- src/components/OpportunityDetailPage.test.tsx
```

Expected: FAIL with unresolved opportunity detail components.

- [ ] **Step 3: Build the activity timeline**

Render user activities with their semantic labels and system activities with transition metadata. Use `occurredAt` for ordering and display, and `createdAt` only as audit metadata.

```tsx
const USER_ACTIVITY_LABELS = {
  note: "Note",
  meeting: "Meeting",
  call: "Call",
  email: "Email",
  message: "Message",
  introduction: "Introduction"
} as const;
```

Empty copy is `No activity has been recorded yet.` and the timeline aria label is `Opportunity activity history`.

- [ ] **Step 4: Build task controls**

`OpportunityTaskList` displays open tasks first, then completed/cancelled history in a collapsed section. Exact mutation mapping:

```ts
complete -> { action: "complete" }
cancel -> { action: "cancel" }
reopen -> { action: "reopen" }
reschedule -> { action: "reschedule", dueDate: "YYYY-MM-DD" | null }
```

Disable the task being mutated, keep other tasks interactive, and replace the parent detail with the API response.

- [ ] **Step 5: Build the shared detail shell**

Fetch `/api/opportunities/:id`. Reuse `Modal`, `Toast`, job form, and connection form. Shared actions are record interaction, add task, move stage, edit details, archive, and permanent delete.

The record-interaction modal contains activity type, body, occurrence date, optional next-task title, and optional due date. Submit once to `/activities` so storage remains transactional.

- [ ] **Step 6: Add the opportunity detail route**

```tsx
import { OpportunityDetailPage } from "../../../components/OpportunityDetailPage";

export default async function OpportunityDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OpportunityDetailPage opportunityId={id} />;
}
```

- [ ] **Step 7: Add responsive task and activity styling**

Add focused styles for `.task-list`, `.task-item`, `.activity-timeline`, `.connection-summary`, and `.detail-action-bar`. On mobile, task actions wrap below task text and modals remain within the viewport.

- [ ] **Step 8: Run detail tests**

```bash
npm test -- src/components/OpportunityDetailPage.test.tsx
```

Expected: PASS for both types, status, activity, task, edit, archive, delete, loading, and error states.

- [ ] **Step 9: Commit shared opportunity detail behavior**

```bash
git add src/components/OpportunityDetailPage.tsx src/components/OpportunityDetailPage.test.tsx src/components/OpportunityActivityTimeline.tsx src/components/OpportunityTaskList.tsx src/app/opportunities/[id]/page.tsx src/app/globals.css
git rm src/components/ApplicationDetailPage.tsx src/components/ActivityTimeline.tsx
git commit -m "feat: add opportunity activity and tasks"
```

---

### Task 6: Linked Jobs, Artifacts, and Legacy Redirects

**Risk:** Medium. Artifact security and ID-preserving navigation must not regress.

**Dependencies:** Tasks 2, 4, and 5.

**Files:**

- Create: `src/app/api/opportunities/[id]/artifacts/[artifactId]/file/route.ts`
- Create: `src/components/OpportunityArtifactViewer.tsx`
- Modify: `src/components/OpportunityDetailPage.tsx`
- Modify: `src/components/OpportunityDetailPage.test.tsx`
- Modify: `src/app/applications/[id]/page.tsx`
- Delete: `src/components/ApplicationArtifactViewer.tsx`
- Delete: `src/app/api/applications/[id]/artifacts/[artifactId]/file/route.ts`
- Delete: remaining `src/app/api/applications/**` routes
- Delete: `src/app/api/followups/route.ts`

**Interfaces:**

- Consumes: `POST /api/opportunities/:connectionId/jobs` and opportunity artifact lookup.
- Produces: bidirectional origin navigation and opportunity-scoped artifact URLs.

- [ ] **Step 1: Add failing linked-job and artifact tests**

Assert a connection displays every originated job and a job displays its origin. Submit the job form from a connection and assert the request path and prefilled fields:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  `/api/opportunities/${connection.id}/jobs`,
  expect.objectContaining({ method: "POST" })
);
expect(linkedJob.origin?.id).toBe(connection.id);
```

Add route tests proving artifact IDs are resolved only within the requested job opportunity and connection artifact requests return `400`.

- [ ] **Step 2: Run focused tests and confirm failures**

```bash
npm test -- src/components/OpportunityDetailPage.test.tsx src/app/api/opportunities/api.test.ts
```

Expected: FAIL because linked-job UI and artifact route are absent.

- [ ] **Step 3: Add create-job-from-connection UI**

Open `JobOpportunityForm` with:

```ts
{
  type: "job",
  label: "",
  organization: connection.organization,
  status: "wishlist",
  priority: connection.priority,
  summary: null,
  url: null,
  source: "Connection",
  location: null,
  contact: `${connection.label}${connection.roleContext ? ` - ${connection.roleContext}` : ""}`,
  appliedDate: null,
  originOpportunityId: connection.id
}
```

After creation, route to the new job detail. The connection retains its current status.

- [ ] **Step 4: Port artifact viewer and file route**

Rename component props to `opportunityId` and build URLs as:

```ts
function fileUrl(opportunityId: string, artifactId: string) {
  return `/api/opportunities/${opportunityId}/artifacts/${artifactId}/file`;
}
```

The server route obtains `OpportunityDetail`, rejects non-job opportunities, finds the artifact within that detail, strips quotes from the filename, and returns `Content-Disposition: inline` with the stored content type.

- [ ] **Step 5: Add ID-preserving legacy redirects**

Replace the old detail page with:

```ts
import { redirect } from "next/navigation";

export default async function LegacyApplicationDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/opportunities/${id}`);
}
```

Remove old application API routes only after all client and script references use opportunity routes or direct opportunity tables.

- [ ] **Step 6: Run linked-job and artifact tests**

```bash
npm test -- src/components/OpportunityDetailPage.test.tsx src/app/api/opportunities/api.test.ts
```

Expected: PASS for linked job creation, both navigation directions, artifact display, file serving, invalid ownership, and legacy redirects.

- [ ] **Step 7: Commit linking and compatibility navigation**

```bash
git add src/app/api/opportunities src/components/OpportunityArtifactViewer.tsx src/components/OpportunityDetailPage.tsx src/components/OpportunityDetailPage.test.tsx src/app/applications/[id]/page.tsx
git rm src/components/ApplicationArtifactViewer.tsx src/app/api/applications src/app/api/followups/route.ts
git commit -m "feat: link connections to job opportunities"
```

---

### Task 7: Posting Intake, Artifact Scripts, and Packaged Skills

**Risk:** High. These scripts are the bridge between external agents and the private local database.

**Dependencies:** Tasks 1 and 6.

**Files:**

- Modify: `scripts/upsert-job-posting.mjs`
- Modify: `scripts/upsert-job-posting.test.ts`
- Modify: `scripts/register-application-artifact.mjs`
- Modify: `scripts/register-application-artifact.test.ts`
- Modify: `scripts/backfill-application-artifacts.mjs`
- Modify: `scripts/backfill-application-artifacts.test.ts`
- Modify: `skills/job-tracker-add-posting/SKILL.md`
- Modify: `skills/job-tracker-add-posting/references/schema.md`
- Modify: `skills/job-application-resume/SKILL.md`
- Modify: `.claude/skills/job-tracker-add-posting/SKILL.md`
- Modify: `.claude/skills/job-application-resume/SKILL.md`
- Modify: `scripts/install-skills.test.ts`

**Interfaces:**

- Consumes: opportunity schema from Task 1.
- Produces: canonical script JSON `{ action, opportunity, application, changes, activityIds, taskIds }` where `application` is a one-release deprecated alias of `opportunity`.

- [ ] **Step 1: Rewrite script tests against opportunity tables first**

Keep all current duplicate/reactivation cases and change assertions to:

```ts
expect(result.opportunity).toMatchObject({
  type: "job",
  label: "Engineering Manager",
  organization: "Acme",
  status: "wishlist",
  url: "https://example.com/job"
});
expect(result.application).toEqual(result.opportunity);
expect(database.prepare("SELECT COUNT(*) AS count FROM opportunities WHERE type = 'job'").get()).toEqual({ count: 1 });
```

Assert duplicate updates append a `note` activity and do not create a connection duplicate with the same organization and label.

- [ ] **Step 2: Run script tests and confirm legacy-schema failures**

```bash
npm test -- scripts/upsert-job-posting.test.ts scripts/register-application-artifact.test.ts scripts/backfill-application-artifacts.test.ts scripts/install-skills.test.ts
```

Expected: FAIL because scripts still read and write application tables.

- [ ] **Step 3: Port posting upsert to job opportunities**

Keep the command name and arguments for one-release compatibility. Ensure the opportunity schema using shared SQL equivalent to Task 1, run legacy migration before lookup, and limit duplicate matching to `type = 'job'`.

Map old output fields for compatibility:

```js
const opportunity = getJobOpportunity(db, opportunityId);
return {
  action,
  opportunity,
  application: opportunity,
  changes,
  activityIds,
  taskIds
};
```

Replace note IDs with activity IDs. A requested follow-up creates an open task and a `task_created` activity transactionally.

- [ ] **Step 4: Port artifact registration and backfill**

Support `--opportunity-id` as canonical and `--application-id` as a deprecated alias. Company/role matching searches job opportunities by normalized organization/label. Reject connection IDs with `Artifacts can only be registered to job opportunities`.

Write `opportunity_artifacts` and preserve the existing unique key `(opportunity_id, type, file_path)`.

- [ ] **Step 5: Update skill source and Claude copies**

Replace verification language with:

```text
Confirm action is created or updated.
Confirm opportunity.type is job.
Confirm opportunity.organization, opportunity.label, opportunity.url, and opportunity.status match the posting.
Confirm changes and activityIds document duplicate updates.
Treat application as a deprecated output alias and do not depend on it in new workflows.
```

Update schema references to document all opportunity tables, connection statuses, task states, duplicate rules, and verification queries. In the resume skill, register files with `--opportunity-id` when the verified record ID is available.

- [ ] **Step 6: Run all script and skill-install tests**

```bash
npm test -- scripts/upsert-job-posting.test.ts scripts/register-application-artifact.test.ts scripts/backfill-application-artifacts.test.ts scripts/install-skills.test.ts
```

Expected: PASS for new records, duplicates, reactivation, migration, aliases, job-only artifacts, backfill, and synchronized skill content.

- [ ] **Step 7: Commit agent workflow compatibility**

```bash
git add scripts/upsert-job-posting.mjs scripts/upsert-job-posting.test.ts scripts/register-application-artifact.mjs scripts/register-application-artifact.test.ts scripts/backfill-application-artifacts.mjs scripts/backfill-application-artifacts.test.ts scripts/install-skills.test.ts skills .claude/skills
git commit -m "feat: migrate agent workflows to opportunities"
```

---

### Task 8: Documentation and Full Acceptance

**Risk:** Medium. This is the release gate for migration safety and user-facing consistency.

**Dependencies:** Tasks 1 through 7.

**Files:**

- Modify: `README.md`
- Modify: `docs/agent-setup.md`
- Modify: `CHANGELOG.md`
- Modify: `src/app/layout.tsx`

**Interfaces:**

- Consumes: all completed feature behavior.
- Produces: release-ready documentation and verification evidence.

- [ ] **Step 1: Update product and setup documentation**

Change the product description to `Local-first opportunity tracker for job applications and professional connections`. Document:

- Automatic legacy migration and preserved IDs.
- Job and connection creation.
- Activities and completable tasks.
- Connection-to-job linking.
- Existing artifact file behavior.
- Posting-intake compatibility output and deprecated `application` alias.
- Private handling of `.env.local`, SQLite files, resumes, and generated materials.

- [ ] **Step 2: Add the changelog entry and metadata copy**

Use a release entry containing:

```markdown
## Unreleased

### Added
- Unified opportunities for job postings and professional connections.
- Connection lifecycle, relationship strength, activity history, and actionable reminders.
- Linked job opportunities originating from connections.

### Changed
- Existing applications migrate automatically to job opportunities while preserving IDs and materials.
- Public posting and artifact scripts now use opportunity records with one-release compatibility aliases.
```

Update the root layout metadata title and description from application-only language to opportunity language.

- [ ] **Step 3: Run the complete deterministic verification suite**

```bash
npm run verify
```

Expected: ESLint exits `0`, TypeScript exits `0`, and every Vitest suite passes.

- [ ] **Step 4: Run the production build**

```bash
npm run build
```

Expected: Next.js production build exits `0`; `/`, `/opportunities/new`, `/opportunities/[id]`, and opportunity API handlers compile successfully.

- [ ] **Step 5: Perform migration acceptance against a disposable database copy**

Never point this check at the only copy of the user's database. Copy it to a temporary path, start the app against the copy, and inspect counts without record contents:

```bash
tmp_db="$(mktemp -t jobtracker-opportunity-XXXXXX.sqlite)"
cp "${JOBTRACKER_DB_PATH:-./data/jobtracker.sqlite}" "$tmp_db"
JOBTRACKER_DB_PATH="$tmp_db" npx tsx -e "import { listOpportunities } from './src/lib/storage.ts'; console.log(listOpportunities().length)"
sqlite3 "$tmp_db" "SELECT (SELECT COUNT(*) FROM applications), (SELECT COUNT(*) FROM opportunities WHERE type = 'job');"
rm -f "$tmp_db" "$tmp_db-shm" "$tmp_db-wal"
```

Expected: the two counts match, the build succeeds, and the live database is unchanged.

- [ ] **Step 6: Perform visual and interaction acceptance**

Run `npm run dev` and inspect:

- Empty and populated dashboard at desktop and mobile widths.
- Mixed job/connection rows and type-aware filters.
- New job and new connection flows.
- Backdated activity creation.
- Task creation, completion, cancellation, reopening, and rescheduling.
- Connection-to-job creation and both navigation directions.
- Existing job artifact Markdown and PDF rendering.
- Legacy `/applications/:id` redirects.
- Archived records excluded by default and retrievable through archive filters.

Expected: no clipped controls, inaccessible modal actions, stale state after mutations, or application-only primary navigation copy.

- [ ] **Step 7: Commit documentation and release evidence**

```bash
git add README.md docs/agent-setup.md CHANGELOG.md src/app/layout.tsx
git commit -m "docs: document opportunity workflow"
```

---

## Dependency Graph and Review Gates

```text
Task 1: Domain + migration [high risk]
  -> Task 2: APIs
  -> Task 3: Dashboard
  -> Task 4: Creation
Task 2 + Task 4
  -> Task 5: Detail + tasks
Task 2 + Task 4 + Task 5
  -> Task 6: Linking + artifacts
Task 1 + Task 6
  -> Task 7: Agent workflows [high risk]
Tasks 1-7
  -> Task 8: Full acceptance
```

Require explicit review after Task 1 before any UI work and after Task 7 before release verification. The Task 1 review must inspect migration idempotency, rollback behavior, preserved IDs, task deduplication, and artifact paths. The Task 7 review must inspect duplicate matching, inactive-status behavior, compatibility aliases, and job-only artifact enforcement.

## Final Acceptance Checklist

- [ ] Existing application count equals migrated job-opportunity count on a disposable database copy.
- [ ] No legacy source table is modified after the migration marker is written.
- [ ] Existing IDs continue to resolve through legacy browser redirects.
- [ ] Jobs and connections share search, priority, tasks, activity, and attention behavior.
- [ ] Status validation is type-specific in storage and API layers.
- [ ] Task transitions and status changes append activities transactionally.
- [ ] Connections can originate multiple jobs without changing type.
- [ ] Artifacts remain readable and cannot attach to connections.
- [ ] Posting intake does not create normalized organization/role duplicates.
- [ ] Codex and Claude packaged skill text matches the opportunity schema and script output.
- [ ] `npm run verify` passes.
- [ ] `npm run build` passes.
- [ ] Desktop and mobile acceptance checks pass with empty and populated data.
