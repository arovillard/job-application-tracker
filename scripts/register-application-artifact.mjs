#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const ARTIFACT_TYPES = new Set([
  "fit_analysis",
  "outreach_message",
  "referral_message",
  "cover_letter",
  "resume",
  "posting",
  "other"
]);

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    parsed[key] = value;
    index += 1;
  }

  return parsed;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }

  return value.trim();
}

function normalizeKey(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function dbPathFromArgs(args) {
  if (args.db) {
    return path.resolve(args.db);
  }

  if (process.env.JOBTRACKER_DB_PATH?.trim()) {
    return path.resolve(process.env.JOBTRACKER_DB_PATH.trim());
  }

  return path.join(process.cwd(), "data", "jobtracker.sqlite");
}

function ensureArtifactSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS application_artifacts (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'text/markdown',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(application_id, type, file_path),
      FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS application_artifacts_application_updated_idx
      ON application_artifacts(application_id, updated_at DESC);
  `);
}

function findApplication(db, args) {
  if (args["application-id"]) {
    return db.prepare("SELECT id, company, role FROM applications WHERE id = ?").get(args["application-id"]);
  }

  const company = normalizeKey(requiredText(args.company, "Company"));
  const role = normalizeKey(requiredText(args.role, "Role"));
  const rows = db
    .prepare("SELECT id, company, role FROM applications")
    .all()
    .filter((row) => normalizeKey(row.company) === company && normalizeKey(row.role) === role);

  if (rows.length > 1) {
    throw new Error("Multiple matching applications found; rerun with --application-id");
  }

  return rows[0] ?? null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const type = requiredText(args.type, "Artifact type");

  if (!ARTIFACT_TYPES.has(type)) {
    throw new Error(`Artifact type is invalid: ${type}`);
  }

  const title = requiredText(args.title, "Artifact title");
  const filePath = path.resolve(requiredText(args.file, "Artifact file"));
  const contentType = args["content-type"]?.trim() || "text/markdown";
  const dbPath = dbPathFromArgs(args);

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  try {
    ensureArtifactSchema(db);
    const application = findApplication(db, args);

    if (!application) {
      throw new Error("Application not found");
    }

    const now = new Date().toISOString();
    const artifactId = randomUUID();
    db.transaction(() => {
      db.prepare(
        `
          INSERT INTO application_artifacts (
            id,
            application_id,
            type,
            title,
            file_path,
            content_type,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(application_id, type, file_path)
          DO UPDATE SET
            title = excluded.title,
            content_type = excluded.content_type,
            updated_at = excluded.updated_at
        `
      ).run(artifactId, application.id, type, title, filePath, contentType, now, now);
      db.prepare("UPDATE applications SET updated_at = ? WHERE id = ?").run(now, application.id);
    })();

    const artifact = db
      .prepare(
        `
          SELECT *
          FROM application_artifacts
          WHERE application_id = ?
            AND type = ?
            AND file_path = ?
        `
      )
      .get(application.id, type, filePath);

    process.stdout.write(
      `${JSON.stringify(
        {
          action: "registered",
          application,
          artifact: {
            id: artifact.id,
            applicationId: artifact.application_id,
            type: artifact.type,
            title: artifact.title,
            filePath: artifact.file_path,
            contentType: artifact.content_type,
            createdAt: artifact.created_at,
            updatedAt: artifact.updated_at
          }
        },
        null,
        2
      )}\n`
    );
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
