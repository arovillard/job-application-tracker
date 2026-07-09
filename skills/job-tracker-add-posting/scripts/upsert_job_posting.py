#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

APPLICATION_STATUSES = {"wishlist", "applied", "interviewing", "offer", "rejected", "archived"}
POSTING_STATES = {"open", "closed", "unknown"}
DEFAULT_DB_PATH = Path(os.environ.get("JOBTRACKER_DB_PATH") or Path.cwd() / "data" / "jobtracker.sqlite")
INACTIVE_STATUSES = {"archived", "rejected"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def compact_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", value).strip()
    return text or None


def require_text(value: str | None, label: str) -> str:
    text = compact_text(value)
    if not text:
        raise SystemExit(f"{label} is required")
    return text


def optional_date(value: str | None, label: str) -> str | None:
    text = compact_text(value)
    if text is None:
        return None
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        raise SystemExit(f"{label} must use YYYY-MM-DD format")
    return text


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def derive_source(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return host or "Public job posting"


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    ensure_schema(conn)
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS applications (
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
        );

        CREATE INDEX IF NOT EXISTS applications_status_idx
          ON applications(status);

        CREATE INDEX IF NOT EXISTS applications_updated_at_idx
          ON applications(updated_at DESC);

        CREATE TABLE IF NOT EXISTS application_notes (
          id TEXT PRIMARY KEY,
          application_id TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'update',
          body TEXT NOT NULL,
          follow_up_date TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS application_notes_application_created_idx
          ON application_notes(application_id, created_at);

        CREATE TABLE IF NOT EXISTS application_status_changes (
          id TEXT PRIMARY KEY,
          application_id TEXT NOT NULL,
          from_status TEXT,
          to_status TEXT NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS application_status_changes_application_created_idx
          ON application_status_changes(application_id, created_at);
        """
    )


def application_projection_sql(where: str) -> str:
    return f"""
        SELECT
          applications.id,
          applications.company,
          applications.role,
          applications.status,
          applications.source,
          applications.location,
          applications.url,
          applications.contact,
          applications.notes,
          applications.applied_date,
          CASE
            WHEN applications.status IN ('archived', 'rejected') THEN NULL
            ELSE (
              SELECT MIN(application_notes.follow_up_date)
              FROM application_notes
              WHERE application_notes.application_id = applications.id
                AND application_notes.type = 'follow_up'
                AND application_notes.follow_up_date IS NOT NULL
            )
          END AS follow_up_date,
          applications.created_at,
          applications.updated_at
        FROM applications
        {where}
    """


def row_to_dict(row: sqlite3.Row | None) -> dict[str, object] | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "company": row["company"],
        "role": row["role"],
        "status": row["status"],
        "source": row["source"],
        "location": row["location"],
        "url": row["url"],
        "contact": row["contact"],
        "notes": row["notes"],
        "appliedDate": row["applied_date"],
        "followUpDate": row["follow_up_date"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def get_application(conn: sqlite3.Connection, application_id: str) -> dict[str, object]:
    row = conn.execute(application_projection_sql("WHERE applications.id = ?"), (application_id,)).fetchone()
    application = row_to_dict(row)
    if application is None:
        raise RuntimeError("Application was not found after write")
    return application


def find_duplicate(conn: sqlite3.Connection, company: str, role: str) -> sqlite3.Row | None:
    company_key = normalize_key(company)
    role_key = normalize_key(role)
    rows = conn.execute("SELECT * FROM applications").fetchall()
    for row in rows:
        if normalize_key(row["company"]) == company_key and normalize_key(row["role"]) == role_key:
            return row
    return None


def insert_status_change(
    conn: sqlite3.Connection,
    application_id: str,
    from_status: str | None,
    to_status: str,
    note: str,
    created_at: str,
) -> None:
    conn.execute(
        """
        INSERT INTO application_status_changes (
          id, application_id, from_status, to_status, note, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (str(uuid.uuid4()), application_id, from_status, to_status, note, created_at),
    )


def insert_note(
    conn: sqlite3.Connection,
    application_id: str,
    note_type: str,
    body: str,
    follow_up_date: str | None,
    created_at: str,
) -> str:
    note_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO application_notes (
          id, application_id, type, body, follow_up_date, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (note_id, application_id, note_type, body, follow_up_date, created_at),
    )
    return note_id


def build_note(
    *,
    action: str,
    source: str,
    url: str,
    posting_state: str,
    changes: list[str],
    note: str | None,
) -> str:
    fragments = [f"{action} from public posting", f"source: {source}", f"url: {url}"]
    if posting_state != "unknown":
        fragments.append(f"posting state: {posting_state}")
    if changes:
        fragments.append("changes: " + "; ".join(changes))
    else:
        fragments.append("changes: none")
    if note:
        fragments.append(f"note: {note}")
    return ". ".join(fragments) + "."


def add_follow_up_if_requested(
    conn: sqlite3.Connection,
    application_id: str,
    follow_up_date: str | None,
    now: str,
) -> str | None:
    if follow_up_date is None:
        return None
    return insert_note(
        conn,
        application_id,
        "follow_up",
        "Follow up",
        follow_up_date,
        now,
    )


def upsert(payload: dict[str, object], db_path: Path, dry_run: bool) -> dict[str, object]:
    company = require_text(payload.get("company") if isinstance(payload.get("company"), str) else None, "Company")
    role = require_text(payload.get("role") if isinstance(payload.get("role"), str) else None, "Role")
    url = require_text(payload.get("url") if isinstance(payload.get("url"), str) else None, "URL")
    source = compact_text(payload.get("source") if isinstance(payload.get("source"), str) else None) or derive_source(url)
    location = compact_text(payload.get("location") if isinstance(payload.get("location"), str) else None)
    contact = compact_text(payload.get("contact") if isinstance(payload.get("contact"), str) else None)
    summary = compact_text(payload.get("summary") if isinstance(payload.get("summary"), str) else None)
    note = compact_text(payload.get("note") if isinstance(payload.get("note"), str) else None)
    applied_date = optional_date(
        payload.get("applied_date") if isinstance(payload.get("applied_date"), str) else None,
        "Applied date",
    )
    follow_up_date = optional_date(
        payload.get("follow_up_date") if isinstance(payload.get("follow_up_date"), str) else None,
        "Follow-up date",
    )
    posting_state = compact_text(
        payload.get("posting_state") if isinstance(payload.get("posting_state"), str) else None
    ) or "unknown"
    if posting_state not in POSTING_STATES:
        raise SystemExit(f"Posting state must be one of: {', '.join(sorted(POSTING_STATES))}")
    requested_status = compact_text(payload.get("status") if isinstance(payload.get("status"), str) else None)
    if requested_status is not None and requested_status not in APPLICATION_STATUSES:
        raise SystemExit(f"Status must be one of: {', '.join(sorted(APPLICATION_STATUSES))}")
    replace_summary = bool(payload.get("replace_summary"))
    reactivate = bool(payload.get("reactivate"))

    conn = connect(db_path)
    now = now_iso()
    conn.execute("BEGIN")
    try:
        existing = find_duplicate(conn, company, role)
        note_ids: list[str] = []
        follow_up_note_id = None

        if existing is None:
            application_id = str(uuid.uuid4())
            status = requested_status or "wishlist"
            conn.execute(
                """
                INSERT INTO applications (
                  id, company, role, status, source, location, url, contact, notes,
                  applied_date, follow_up_date, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
                """,
                (
                    application_id,
                    company,
                    role,
                    status,
                    source,
                    location,
                    url,
                    contact,
                    summary,
                    applied_date,
                    now,
                    now,
                ),
            )
            insert_status_change(conn, application_id, None, status, "Application created", now)
            note_ids.append(
                insert_note(
                    conn,
                    application_id,
                    "update",
                    build_note(
                        action="Added tracker record",
                        source=source,
                        url=url,
                        posting_state=posting_state,
                        changes=["created new application record"],
                        note=note,
                    ),
                    None,
                    now,
                )
            )
            follow_up_note_id = add_follow_up_if_requested(conn, application_id, follow_up_date, now)
            action = "created"
            changes = ["created new application record"]
        else:
            application_id = existing["id"]
            assignments: list[str] = []
            values: list[object] = []
            changes = []

            def update_field(column: str, label: str, new_value: str | None) -> None:
                old_value = existing[column]
                if new_value is not None and new_value != old_value:
                    assignments.append(f"{column} = ?")
                    values.append(new_value)
                    changes.append(f"{label}: {old_value or 'blank'} -> {new_value}")

            update_field("source", "source", source)
            update_field("location", "location", location)
            update_field("url", "url", url)
            update_field("contact", "contact", contact)
            if summary is not None and (replace_summary or not existing["notes"]):
                update_field("notes", "summary", summary)

            next_status = requested_status
            if next_status is None and reactivate and existing["status"] in INACTIVE_STATUSES and posting_state != "closed":
                next_status = "wishlist"
            if next_status is not None and next_status != existing["status"]:
                assignments.append("status = ?")
                values.append(next_status)
                changes.append(f"status: {existing['status']} -> {next_status}")
                insert_status_change(
                    conn,
                    application_id,
                    existing["status"],
                    next_status,
                    "Status updated from public posting review",
                    now,
                )

            if assignments:
                assignments.append("updated_at = ?")
                values.append(now)
                values.append(application_id)
                conn.execute(
                    f"UPDATE applications SET {', '.join(assignments)} WHERE id = ?",
                    tuple(values),
                )
            else:
                conn.execute("UPDATE applications SET updated_at = ? WHERE id = ?", (now, application_id))

            note_ids.append(
                insert_note(
                    conn,
                    application_id,
                    "update",
                    build_note(
                        action="Reviewed existing tracker record",
                        source=source,
                        url=url,
                        posting_state=posting_state,
                        changes=changes,
                        note=note,
                    ),
                    None,
                    now,
                )
            )
            follow_up_note_id = add_follow_up_if_requested(conn, application_id, follow_up_date, now)
            action = "updated"

        application = get_application(conn, application_id)
        if dry_run:
            conn.rollback()
        else:
            conn.commit()
        conn.close()

        return {
            "action": action,
            "dryRun": dry_run,
            "dbPath": str(db_path),
            "application": application,
            "changes": changes,
            "noteIds": note_ids,
            "followUpNoteId": follow_up_note_id,
        }
    except Exception:
        conn.rollback()
        conn.close()
        raise


def read_json(path: str) -> dict[str, object]:
    raw = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise SystemExit("Input JSON must be an object")
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create or update a public job posting in the local JobTracker SQLite database."
    )
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="Path to jobtracker.sqlite")
    parser.add_argument("--input-json", help="Read fields from a JSON file, or '-' for stdin")
    parser.add_argument("--company")
    parser.add_argument("--role")
    parser.add_argument("--url")
    parser.add_argument("--source")
    parser.add_argument("--location")
    parser.add_argument("--contact")
    parser.add_argument("--summary", help="Short posting summary to store in the application summary field")
    parser.add_argument("--note", help="Extra context to append to the tracker note")
    parser.add_argument("--status", choices=sorted(APPLICATION_STATUSES))
    parser.add_argument("--posting-state", choices=sorted(POSTING_STATES), dest="posting_state")
    parser.add_argument("--applied-date", dest="applied_date")
    parser.add_argument("--follow-up-date", dest="follow_up_date")
    parser.add_argument("--replace-summary", action="store_true")
    parser.add_argument(
        "--reactivate",
        action="store_true",
        help="If an existing duplicate is archived or rejected and the posting is not closed, set it to wishlist.",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    payload = read_json(args.input_json) if args.input_json else {}
    for field in (
        "company",
        "role",
        "url",
        "source",
        "location",
        "contact",
        "summary",
        "note",
        "status",
        "posting_state",
        "applied_date",
        "follow_up_date",
    ):
        value = getattr(args, field)
        if value is not None:
            payload[field] = value
    if args.replace_summary:
        payload["replace_summary"] = True
    if args.reactivate:
        payload["reactivate"] = True

    result = upsert(payload, Path(args.db).expanduser().resolve(), args.dry_run)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
