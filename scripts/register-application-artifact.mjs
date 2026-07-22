#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ensureOpportunitySchema, migrateLegacyApplications } from "./lib/opportunity-schema.mjs";
import { assertCurrentOpportunitySchema } from "./lib/current-opportunity-schema.mjs";
import { verifyDailyJobPrepLock } from "./lib/daily-job-prep-lock.mjs";

const TYPES = new Set(["fit_analysis", "outreach_message", "referral_message", "cover_letter", "resume", "posting", "other"]);
const text = (value, label) => { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`); return value.trim(); };
const key = (value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function args(argv) { const result = {}; for (let i = 0; i < argv.length; i += 2) { if (!argv[i]?.startsWith("--") || !argv[i + 1] || argv[i + 1].startsWith("--") || Object.hasOwn(result, argv[i].slice(2))) throw new Error(`Missing or duplicate value for ${argv[i]}`); result[argv[i].slice(2)] = argv[i + 1]; } return result; }
function dbPath(input) { return input.db ? path.resolve(input.db) : process.env.JOBTRACKER_DB_PATH?.trim() ? path.resolve(process.env.JOBTRACKER_DB_PATH) : path.join(process.cwd(), "data", "jobtracker.sqlite"); }
function find(db, input) { const id = input["opportunity-id"] || input["application-id"]; if (id) return db.prepare("SELECT * FROM opportunities WHERE id=?").get(id); const organization = key(text(input.company, "Company")), label = key(text(input.role, "Role")); const rows = db.prepare("SELECT * FROM opportunities WHERE type='job'").all().filter((item) => key(item.organization || "") === organization && key(item.label) === label); if (rows.length > 1) throw new Error("Multiple matching job opportunities found; rerun with --opportunity-id"); return rows[0] || null; }
function validate(options) { const type = text(options.type, "Artifact type"); if (!TYPES.has(type)) throw new Error(`Artifact type is invalid: ${type}`); const filePath = path.resolve(text(options.file, "Artifact file")); if (!existsSync(filePath)) throw new Error(`Artifact file not found: ${filePath}`); let fileStat; try { fileStat = statSync(filePath); } catch { throw new Error(`Artifact file could not be inspected: ${filePath}`); } if (!fileStat.isFile()) throw new Error(`Artifact path is not a regular file: ${filePath}`); const automated = Object.hasOwn(options, "lock-token") || Object.hasOwn(options, "expected-status"); if (automated && (!options["lock-token"] || !options["expected-status"])) throw new Error("lock-token and expected-status must be supplied together"); return { type, filePath, title: text(options.title, "Artifact title"), contentType: options["content-type"]?.trim() || "text/markdown", automated, databasePath: dbPath(options) }; }
export function registerApplicationArtifact(options, dependencies = {}) {
  const input = validate(options), DB = dependencies.Database || Database;
  if (!existsSync(input.databasePath)) throw new Error(`Database not found: ${input.databasePath}`);
  if (input.automated) verifyDailyJobPrepLock(input.databasePath, options["lock-token"]);
  const db = new DB(input.databasePath); db.pragma("foreign_keys = ON");
  try {
    if (input.automated) assertCurrentOpportunitySchema(db); else { ensureOpportunitySchema(db); migrateLegacyApplications(db); }
    let opportunity;
    const timestamp = new Date().toISOString();
    db.transaction(() => {
      if (input.automated) verifyDailyJobPrepLock(db, options["lock-token"]);
      opportunity = find(db, options);
      if (!opportunity) throw new Error("Job opportunity not found");
      if (opportunity.type !== "job") throw new Error("Artifacts can only be registered to job opportunities");
      if (input.automated && opportunity.status !== options["expected-status"]) throw new Error("Opportunity status no longer matches expected status");
      db.prepare("INSERT INTO opportunity_artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(opportunity_id,type,file_path) DO UPDATE SET title=excluded.title,content_type=excluded.content_type,updated_at=excluded.updated_at").run(randomUUID(), opportunity.id, input.type, input.title, input.filePath, input.contentType, timestamp, timestamp);
      db.prepare("UPDATE opportunities SET updated_at=? WHERE id=?").run(timestamp, opportunity.id);
    })();
    const artifact = db.prepare("SELECT * FROM opportunity_artifacts WHERE opportunity_id=? AND type=? AND file_path=?").get(opportunity.id, input.type, input.filePath);
    const record = { id: opportunity.id, type: opportunity.type, label: opportunity.label, organization: opportunity.organization, status: opportunity.status };
    return { action: "registered", opportunity: record, application: record, artifact: { id: artifact.id, opportunityId: artifact.opportunity_id, applicationId: artifact.opportunity_id, type: artifact.type, title: artifact.title, filePath: artifact.file_path, contentType: artifact.content_type, createdAt: artifact.created_at, updatedAt: artifact.updated_at } };
  } finally { db.close(); }
}
function main() { const result = registerApplicationArtifact(args(process.argv.slice(2))); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); }
if (import.meta.url === `file://${process.argv[1]}`) try { main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); }
