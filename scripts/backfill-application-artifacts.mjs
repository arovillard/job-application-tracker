#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".pdf", ".doc", ".docx", ".txt"]);
const VISIBLE_MATERIAL_TYPES = ["resume", "fit_analysis", "outreach_message"];

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

function dbPathFromArgs(args) {
  if (args.db) {
    return path.resolve(args.db);
  }

  if (process.env.JOBTRACKER_DB_PATH?.trim()) {
    return path.resolve(process.env.JOBTRACKER_DB_PATH.trim());
  }

  return path.join(process.cwd(), "data", "jobtracker.sqlite");
}

function applicationsDirFromArgs(args) {
  if (args["applications-dir"]) {
    return path.resolve(args["applications-dir"]);
  }

  if (process.env.JOBTRACKER_APPLICATIONS_DIR?.trim()) {
    return path.resolve(process.env.JOBTRACKER_APPLICATIONS_DIR.trim());
  }

  return path.join(process.cwd(), "applications");
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

function normalizeKey(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function titleFromFile(filePath) {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function classifyFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  const extension = path.extname(filePath).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return null;
  }

  if (name.includes("fit-analysis") || name.includes("fit analysis")) {
    return { type: "fit_analysis", title: "Fit Analysis" };
  }

  if (name.includes("reach-out") || name.includes("outreach")) {
    return { type: "outreach_message", title: "Outreach Message" };
  }

  if (name.includes("resume")) {
    return { type: "resume", title: titleFromFile(filePath) || "Resume" };
  }

  return null;
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".md" || extension === ".markdown") {
    return "text/markdown";
  }

  if (extension === ".pdf") {
    return "application/pdf";
  }

  if (extension === ".txt") {
    return "text/plain";
  }

  if (extension === ".doc") {
    return "application/msword";
  }

  if (extension === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  return "application/octet-stream";
}

function listFiles(root) {
  if (!existsSync(root)) {
    throw new Error(`Applications directory not found: ${root}`);
  }

  const files = [];
  const entries = readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);

    if (entry.name.startsWith(".")) {
      continue;
    }

    if (entry.isDirectory()) {
      for (const child of readdirSync(entryPath, { withFileTypes: true })) {
        const childPath = path.join(entryPath, child.name);

        if (child.name.startsWith(".") || child.isDirectory()) {
          continue;
        }

        if (child.isFile()) {
          files.push(childPath);
        }
      }
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function findApplicationForFile(applications, applicationsDir, filePath) {
  const relative = path.relative(applicationsDir, filePath);
  const folderName = relative.split(path.sep)[0] ?? "";
  const folderKey = normalizeKey(folderName);
  const matches = applications.filter((application) => normalizeKey(application.company) === folderKey);

  if (matches.length === 1) {
    return { application: matches[0], reason: null };
  }

  if (matches.length > 1) {
    return { application: null, reason: "multiple_matching_applications" };
  }

  return { application: null, reason: "no_matching_application" };
}

function registerArtifact(db, application, artifact, filePath) {
  const now = new Date().toISOString();
  const artifactId = randomUUID();

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
  ).run(
    artifactId,
    application.id,
    artifact.type,
    artifact.title,
    path.resolve(filePath),
    contentTypeFor(filePath),
    now,
    now
  );
  db.prepare("UPDATE applications SET updated_at = ? WHERE id = ?").run(now, application.id);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = dbPathFromArgs(args);
  const applicationsDir = applicationsDirFromArgs(args);

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  try {
    ensureArtifactSchema(db);
    const applications = db.prepare("SELECT id, company, role FROM applications").all();
    const files = listFiles(applicationsDir);
    const skipped = [];
    let registered = 0;

    db.transaction(() => {
      db.prepare(
        `DELETE FROM application_artifacts WHERE type NOT IN (${VISIBLE_MATERIAL_TYPES.map(() => "?").join(", ")})`
      ).run(...VISIBLE_MATERIAL_TYPES);

      for (const filePath of files) {
        if (!statSync(filePath).isFile()) {
          continue;
        }

        const artifact = classifyFile(filePath);

        if (!artifact) {
          skipped.push({ path: filePath, reason: "unsupported_material_type" });
          continue;
        }

        const match = findApplicationForFile(applications, applicationsDir, filePath);

        if (!match.application) {
          skipped.push({ path: filePath, reason: match.reason });
          continue;
        }

        registerArtifact(db, match.application, artifact, filePath);
        registered += 1;
      }
    })();

    process.stdout.write(
      `${JSON.stringify(
        {
          applicationsDir,
          scannedFiles: files.length,
          registered,
          skipped
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
