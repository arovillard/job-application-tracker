# JobTracker SQLite Reference

Use this only when `scripts/upsert_job_posting.py` is blocked or when you need to explain the tracker state.

## Database

Default path:

```text
JOBTRACKER_DB_PATH, or ./data/jobtracker.sqlite from the project root
```

Override path for tests or unusual environments with `--db` or `JOBTRACKER_DB_PATH`.

## Tables

`applications`

```sql
id TEXT PRIMARY KEY,
company TEXT NOT NULL,
role TEXT NOT NULL,
status TEXT NOT NULL,
source TEXT,
location TEXT,
url TEXT,
contact TEXT,
notes TEXT,
applied_date TEXT,
follow_up_date TEXT,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL
```

Valid statuses:

```text
wishlist, applied, interviewing, offer, rejected, archived
```

`application_notes`

```sql
id TEXT PRIMARY KEY,
application_id TEXT NOT NULL,
type TEXT NOT NULL DEFAULT 'update',
body TEXT NOT NULL,
follow_up_date TEXT,
created_at TEXT NOT NULL
```

Valid note types:

```text
update, internal, follow_up
```

Follow-ups are typed notes: `type = 'follow_up'` with `follow_up_date = YYYY-MM-DD`.

`application_status_changes`

```sql
id TEXT PRIMARY KEY,
application_id TEXT NOT NULL,
from_status TEXT,
to_status TEXT NOT NULL,
note TEXT,
created_at TEXT NOT NULL
```

## App Conventions

- Do not create duplicate records for the same normalized company and role.
- Insert new public postings as `wishlist` unless the user explicitly says the application was already submitted.
- Keep records active when sources disagree about whether a posting is open. Do not archive a posting unless the user explicitly confirms that.
- Store posting context in `applications.notes` only when creating the record or when the current summary is blank. Otherwise add an `update` note so user-written summaries are not overwritten.
- Every created application needs an initial `application_status_changes` row with `from_status = NULL`, `to_status = current status`, and `note = 'Application created'`.
- Every duplicate update should add an `update` note describing the source URL and any changed fields.

## Verification Queries

Find a record:

```sql
SELECT id, company, role, status, source, location, url, notes, updated_at
FROM applications
WHERE lower(company) LIKE lower('%COMPANY%')
ORDER BY updated_at DESC;
```

Read notes:

```sql
SELECT type, body, follow_up_date, created_at
FROM application_notes
WHERE application_id = 'APPLICATION_ID'
ORDER BY created_at ASC;
```

Read status history:

```sql
SELECT from_status, to_status, note, created_at
FROM application_status_changes
WHERE application_id = 'APPLICATION_ID'
ORDER BY created_at ASC;
```
