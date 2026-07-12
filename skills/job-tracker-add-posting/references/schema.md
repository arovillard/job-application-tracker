# Opportunity schema reference

The current workflow writes only opportunity tables. Legacy `applications` tables remain read-only migration evidence.

## Tables

- `opportunities`: shared `id`, `type` (`job` or `connection`), `label`, nullable `organization`, type-valid `status`, `priority` (`low`, `medium`, `high`), `summary`, nullable `origin_opportunity_id`, and timestamps.
- `job_opportunity_details`: job-only `url`, `source`, `location`, `contact`, and `applied_date` keyed by `opportunity_id`.
- `connection_opportunity_details`: connection-only `role_context`, `contact_info`, `meeting_context`, and `relationship_strength` (`new`, `familiar`, `strong`).
- `opportunity_activities`: append-only activity timeline with `note`, interaction types, status changes, and task events.
- `opportunity_tasks`: `open`, `completed`, or `cancelled` follow-up work, optionally linked to an activity.
- `opportunity_artifacts`: job-only application material metadata, uniquely keyed by `(opportunity_id, type, file_path)`.
- `schema_metadata`: migration marker storage.

Job statuses are `wishlist`, `applied`, `interviewing`, `offer`, `rejected`, and `archived`. Connection statuses are `new`, `outreach_planned`, `waiting`, `in_conversation`, `opportunity_identified`, `dormant`, `closed`, and `archived`.

## Duplicate rules

Posting intake compares normalized organization and label only among `type = 'job'` records. A connection with the same organization and label is never a duplicate. Artifact matching by company and role also searches job opportunities only.

## Verification queries

```sql
SELECT o.id, o.type, o.label, o.organization, o.status, d.url
FROM opportunities o
JOIN job_opportunity_details d ON d.opportunity_id = o.id
WHERE o.type = 'job' AND lower(o.organization) = lower('COMPANY')
ORDER BY o.updated_at DESC;

SELECT type, body, occurred_at
FROM opportunity_activities
WHERE opportunity_id = 'OPPORTUNITY_ID'
ORDER BY occurred_at, created_at;

SELECT title, due_date, state
FROM opportunity_tasks
WHERE opportunity_id = 'OPPORTUNITY_ID'
ORDER BY created_at;

SELECT type, title, file_path, content_type
FROM opportunity_artifacts
WHERE opportunity_id = 'OPPORTUNITY_ID'
ORDER BY updated_at DESC;
```
