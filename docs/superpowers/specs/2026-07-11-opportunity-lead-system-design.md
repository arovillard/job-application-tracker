# Opportunity and Connection Lead System

## Summary

Transform JobTracker from an application-only tracker into an opportunity workspace that manages both job opportunities and human connections. An opportunity is the shared top-level record. Each opportunity has one type, `job` or `connection`, and receives shared activity history, tasks, priority, lifecycle tracking, search, and dashboard attention behavior.

The system must preserve all existing application data and application-material links. Connections can produce one or more linked job opportunities without losing the connection's independent history.

## Goals

- Let the user capture a person they met or heard from even when no job posting exists.
- Preserve a chronological history of meetings, messages, notes, introductions, and lifecycle changes.
- Make future work explicit through tasks that can be completed, cancelled, and rescheduled.
- Show jobs and connections together in one searchable opportunity workspace.
- Allow a connection to originate a job opportunity while keeping both records.
- Migrate every existing application, note, follow-up, status change, and artifact without data loss.
- Keep the public-job-posting agent workflow operational after the migration.

## Non-Goals

- Building a general-purpose CRM or standalone contact database.
- Synchronizing email, calendars, LinkedIn, or address books.
- Capturing interactions automatically.
- Attaching multiple people to one opportunity.
- Computing relationship scores or AI rankings.
- Adding kanban, graph, or network visualizations.
- Renaming or redesigning the existing job lifecycle in this release.

## Product Language

- **Opportunity:** The universal record shown in the workspace.
- **Job opportunity:** An existing or prospective job tracked from discovery through outcome.
- **Connection opportunity:** A relationship that may lead to information, an introduction, a referral, or a job opportunity.
- **Activity:** A chronological record of something that happened, including human interactions and system-generated lifecycle events.
- **Task:** A future or current action with an explicit completion state.
- **Origin:** The connection opportunity from which a job opportunity was created.

Use `Opportunity` in navigation, dashboard, creation, empty-state, and shared-detail copy. Use `Job` and `Connection` as type labels. Existing routes containing `applications` may remain only as temporary compatibility redirects.

## Domain Model

### Opportunity

The shared opportunity record owns:

- `id`: stable UUID; migrated applications retain their current IDs.
- `type`: `job` or `connection`.
- `label`: job role for a job; person's name for a connection.
- `organization`: company or organization, nullable for a connection.
- `status`: validated against the selected type's status set.
- `priority`: `low`, `medium`, or `high`.
- `summary`: optional free-text context.
- `originOpportunityId`: nullable connection opportunity ID for jobs created from a connection.
- `createdAt` and `updatedAt`: ISO timestamps.

An origin must reference an existing connection. A connection cannot have an origin. Creating a linked job does not mutate the connection's type, lifecycle, activities, or tasks.

### Job Details

A job opportunity stores these type-specific fields:

- Posting URL
- Posting source
- Location
- Contact name or contact context
- Applied date

Job statuses remain compatible with the current application model:

- `wishlist`
- `applied`
- `interviewing`
- `offer`
- `rejected`
- `archived`

This release does not reinterpret or automatically change existing job statuses.

### Connection Details

A connection opportunity stores:

- Person's role or professional context
- Contact information as optional free text
- Where or how the user met the person
- Relationship strength
- Last interaction date, derived from dated human activities rather than manually maintained

Connection workflow statuses are:

- `new`: captured but not acted on
- `outreach_planned`: making contact is the next step
- `waiting`: contact occurred and a response is pending
- `in_conversation`: active two-way interaction
- `opportunity_identified`: a concrete role, referral, or introduction exists
- `dormant`: inactive but potentially worth revisiting
- `closed`: no further action is expected
- `archived`: hidden from normal working views

Connection relationship strength is independent of workflow status:

- `new`
- `familiar`
- `strong`

Relationship strength is descriptive and never determines whether an opportunity appears in the attention queue.

### Activities

Activities form the authoritative timeline. User-created activity types are:

- `note`
- `meeting`
- `call`
- `email`
- `message`
- `introduction`

System-created activity types are:

- `status_change`
- `task_created`
- `task_completed`
- `task_cancelled`
- `task_rescheduled`
- `opportunity_created`
- `linked_job_created`

Every activity has an ID, opportunity ID, type, human-readable body, occurrence timestamp, creation timestamp, and optional structured metadata. Status metadata records `fromStatus` and `toStatus`. Task-event metadata records the task ID and relevant old and new values.

User-created activities may be backdated. System activities use the time of the operation. Activities are append-only in the first release. Corrections are recorded as new notes rather than silently rewriting history.

### Tasks and Reminders

A task stores:

- `id`
- `opportunityId`
- `title`
- Optional date-only `dueDate` in `YYYY-MM-DD` format
- `state`: `open`, `completed`, or `cancelled`
- Optional `sourceActivityId`
- Optional `completedAt`
- `createdAt` and `updatedAt`

Tasks can be created independently or while recording an activity. Completion, cancellation, and due-date changes create system activities in the same transaction. Completed and cancelled tasks remain available in history but do not appear as future work.

## Data Architecture

Use normalized subtype tables so shared workflow behavior is implemented once while job- and connection-specific fields remain explicit:

- `opportunities`
- `job_opportunity_details`
- `connection_opportunity_details`
- `opportunity_activities`
- `opportunity_tasks`
- `opportunity_artifacts`
- `schema_metadata`

`opportunities` is the parent for every other opportunity table. Foreign keys use `ON DELETE CASCADE`, except `origin_opportunity_id`, which uses `ON DELETE SET NULL` so deleting an originating connection does not delete a job.

Application materials remain file-backed. `opportunity_artifacts` stores only metadata and file paths, following the current artifact behavior. Artifacts are valid only for job opportunities in the first release.

## Migration Contract

The application must migrate an existing database automatically and transactionally before serving reads or writes.

1. Create the new tables and indexes without modifying existing tables.
2. Copy each application to `opportunities` with `type = 'job'`, retaining its ID, status, priority, summary, and timestamps.
3. Copy source, location, URL, contact, and applied date to `job_opportunity_details`.
4. Convert each existing note into an activity with its original body and timestamp.
5. Convert each status-history row into a `status_change` activity with the original timestamp and transition metadata.
6. Convert each typed follow-up note into an open task with the same body and due date unless the job is rejected or archived.
7. Convert an existing `next_action` into an open task. Do not create a second task when an equivalent migrated follow-up already has the same normalized title and due date.
8. Copy artifact records to `opportunity_artifacts`, preserving IDs, paths, types, and timestamps.
9. Record the completed migration version in `schema_metadata` only after all copies succeed.

The migration is idempotent. A failed transaction leaves the old schema untouched and no migration marker. Legacy application tables remain in the database for the first release as read-only rollback evidence; all product and agent writes use the opportunity tables after migration.

Existing `/applications/[id]` browser routes redirect to `/opportunities/[id]`. Existing IDs are preserved so bookmarks continue to resolve.

## Workspace Experience

### Dashboard

Rename the primary workspace to `Opportunities`. Preserve the current table-first layout and add:

- Type filter: `All`, `Jobs`, `Connections`
- Type badge on every row or mobile card
- Search across label, organization, summary, job details, and connection details
- Type-aware status filtering
- Default exclusion of archived records
- Attention filtering across both opportunity types

When `All` is selected, status filtering offers broad views rather than mixing incompatible status values: `Active`, `Needs attention`, `Closed`, and `Archived`. When a single type is selected, its exact statuses are available.

Rows display:

- Job: role, organization, job status, next open task, priority
- Connection: person's name, organization or context, connection status, relationship strength, next open task, priority

### Attention Rules

The attention queue includes:

- Open tasks due today or earlier, ordered by due date and then priority.
- Active opportunities with no open task when their lifecycle requires forward motion.

Connection statuses requiring forward motion are `new`, `outreach_planned`, `waiting`, `in_conversation`, and `opportunity_identified`. `dormant`, `closed`, and `archived` connections never receive a missing-next-action warning.

Job missing-next-action behavior remains compatible with the current dashboard: it applies to `applied`, `interviewing`, and `offer`. Rejected and archived jobs never appear in attention.

Future tasks do not appear in the due queue. An opportunity with any open task, including a future or undated task, does not receive a missing-next-action warning.

### Creation

The primary action becomes `New opportunity`. It first asks the user to choose:

- `Job posting`
- `Connection`

The job form retains current fields and defaults to `wishlist`.

The connection form prioritizes rapid capture:

- Person's name, required
- Organization, optional
- Person's role or context, optional
- Where or how you met, optional
- Initial note, optional
- Relationship strength, default `new`
- Status, default `new`
- Next action title and due date, optional

Creation of the opportunity, initial activity, and optional task occurs in one transaction.

### Detail Page

All opportunity detail pages share:

- Type, label, organization, status, and priority header
- Open-task panel with complete, cancel, and reschedule actions
- Activity timeline
- Add-activity action
- Edit details, archive, and permanent-delete actions

The archive action is primary for removal from normal work. Permanent deletion remains available behind explicit confirmation and deletes dependent local records.

Connection details additionally show relationship strength, meeting context, last interaction, and `Create job opportunity`.

Job details retain posting metadata and application materials. A linked job shows its originating connection. The connection page lists every job it originated.

### Create Job From Connection

`Create job opportunity` opens the job form prefilled with the connection's organization and contact context. On submission:

- Create a new job opportunity with `originOpportunityId` set to the connection ID.
- Add `linked_job_created` activity to the connection.
- Add `opportunity_created` activity to the job that references the connection.
- Do not automatically change the connection's status; the user chooses whether to move it to `opportunity_identified`.

## API Boundaries

Introduce opportunity-oriented API routes:

- `GET /api/opportunities`: list and filter opportunities.
- `POST /api/opportunities`: create a job or connection with optional initial activity and task.
- `GET /api/opportunities/:id`: return type-specific details, activities, tasks, artifacts, origin, and originated jobs.
- `PUT /api/opportunities/:id`: update editable shared and type-specific details.
- `DELETE /api/opportunities/:id`: permanently delete after client confirmation.
- `PATCH /api/opportunities/:id/status`: validate and record a type-specific status transition.
- `POST /api/opportunities/:id/activities`: append a human activity and optionally create a task transactionally.
- `POST /api/opportunities/:id/tasks`: create a task.
- `PATCH /api/opportunities/:id/tasks/:taskId`: complete, cancel, reopen, or reschedule a task.
- `POST /api/opportunities/:id/jobs`: create a linked job from a connection.

Invalid types, statuses, strengths, dates, task transitions, cross-opportunity task IDs, and invalid origin links return `400`. Missing opportunities or tasks return `404`. Storage operations that update multiple records are transactional.

## Agent and Script Compatibility

The public-posting intake workflow continues to run before application-material generation.

- Rename internal script behavior from application upsert to job-opportunity upsert while retaining a compatibility command for the existing script name during one release.
- Duplicate detection remains normalized `organization + job label` among job opportunities only.
- New public postings create `job` opportunities with status `wishlist`.
- Existing inactive-posting rules remain unchanged: conflicting sources do not archive a record automatically.
- Duplicate updates append an activity rather than an application note.
- The script's JSON output uses `opportunity` as the canonical property and temporarily includes `application` as a deprecated alias.
- Update both packaged agent skills and their schema reference so installed Codex and Claude copies describe the opportunity model.
- Application-material generation and artifact registration continue to accept the preserved opportunity ID and are valid only for job opportunities.

## Error Handling and Integrity

- Reject records with a blank job label, blank connection person's name, or an invalid type-specific status.
- Reject connection-only fields on jobs and job-only fields on connections rather than silently dropping them.
- Reject linking a job to a job, a missing connection, or an archived connection.
- Reject no-op status changes.
- Reject completing or cancelling an already terminal task; reopening is an explicit transition.
- Use transactions for creation with initial records, status changes with activities, task transitions with activities, linked-job creation, and migration.
- Surface migration failures as a blocking startup error with the database path and original error, without exposing record contents.

## Testing Strategy

### Storage and Migration

- Fresh-database creation for both opportunity types.
- Migration from the current schema with IDs, timestamps, notes, statuses, tasks, and artifacts preserved.
- Migration rollback and idempotency.
- Type-specific validation and origin-link integrity.
- Task state transitions and system-activity creation.

### API

- List filtering by type, status, search, and archive visibility.
- Creation and update of each subtype.
- Status validation per type.
- Activity plus task transactional creation.
- Linked-job creation and invalid-link errors.

### Dashboard and Components

- Mixed job and connection rendering.
- Type-aware status controls.
- Search across subtype fields.
- Due-task and missing-next-action behavior.
- Empty, loading, and error states.
- Mobile card and desktop table behavior.

### Compatibility

- Existing application URLs redirect by preserved ID.
- Public-posting upsert still creates and updates without duplicates.
- Existing application materials remain readable.
- Installed skill sources and schema reference match the new script output.

Run `npm run verify` and `npm run build` after implementation, then manually inspect populated and empty desktop and mobile views.

## Acceptance Criteria

- Every existing application appears as a job opportunity after automatic migration.
- Existing notes, status history, follow-ups, next actions, and displayed artifacts remain accessible.
- A connection can be created without a job title or posting URL.
- The user can record backdated interactions and see them chronologically.
- The user can create, complete, cancel, reopen, and reschedule tasks.
- Due work from jobs and connections appears in one attention queue.
- A connection can create multiple linked jobs without changing its own type or losing history.
- Jobs and connections can be searched and filtered together or independently.
- Archived records are excluded by default and remain retrievable.
- Public job-posting intake and application-material workflows continue to operate against job opportunities without duplicate records.

## Delivery Sequence

1. Add the opportunity domain, schema, migration, and storage tests.
2. Add opportunity APIs and type-aware validation.
3. Convert dashboard loading, filtering, and attention calculations.
4. Add type selection and connection creation.
5. Build the shared detail experience, activities, and task controls.
6. Add connection-to-job creation and linking.
7. Migrate artifact routes and preserve legacy browser redirects.
8. Update intake scripts, packaged skills, documentation, and compatibility tests.
9. Run full automated and visual acceptance checks.
