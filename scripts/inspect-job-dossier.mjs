#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { assertCurrentOpportunitySchema } from "./lib/current-opportunity-schema.mjs";
import { verifyDailyJobPrepLock } from "./lib/daily-job-prep-lock.mjs";

export const REQUIREMENTS = [
  { key: "resume", type: "resume", requiredTitle: null },
  { key: "fit_analysis", type: "fit_analysis", requiredTitle: null },
  { key: "cover_letter", type: "cover_letter", requiredTitle: null },
  { key: "outreach_message", type: "outreach_message", requiredTitle: null },
  { key: "submission_guide", type: "other", requiredTitle: "Submission Guide" }
];
function parse(argv) { const out = {}; for (let i = 0; i < argv.length; i += 2) { const flag = argv[i], value = argv[i + 1]; if (!flag?.startsWith("--") || !value || value.startsWith("--") || Object.hasOwn(out, flag.slice(2))) throw new Error("Invalid command arguments"); out[flag.slice(2)] = value; } const base = ["db", "opportunity-id"]; if (!base.every((k) => out[k])) throw new Error("--db and --opportunity-id are required"); const guarded = ["lock-token", "expected-status", "expected-updated-at"].filter((k) => out[k]); if (guarded.length && guarded.length !== 3) throw new Error("lock-token, expected-status, and expected-updated-at must be supplied together"); if (![...base, ...guarded.length ? ["lock-token", "expected-status", "expected-updated-at"] : []].every((k) => Object.hasOwn(out, k)) || Object.keys(out).some((k) => ![...base, "lock-token", "expected-status", "expected-updated-at"].includes(k))) throw new Error("Invalid command arguments"); if (!path.isAbsolute(out.db)) throw new Error("database path must be absolute"); return out; }
function assess(filePath) { const absolutePath = typeof filePath === "string" && path.isAbsolute(filePath); if (!absolutePath) return { absolutePath, exists: false, regularFile: false, valid: false }; try { const exists = existsSync(filePath); const regularFile = exists && statSync(filePath).isFile(); return { absolutePath, exists, regularFile, valid: regularFile }; } catch { return { absolutePath, exists: false, regularFile: false, valid: false }; } }
export function inspectJobDossier(options) {
  if (!path.isAbsolute(options.db)) throw new Error("database path must be absolute");
  const guarded = options["lock-token"] || options["expected-status"] || options["expected-updated-at"];
  if (guarded && (!options["lock-token"] || !options["expected-status"] || !options["expected-updated-at"])) throw new Error("lock-token, expected-status, and expected-updated-at must be supplied together");
  if (!existsSync(options.db)) throw new Error(`Database not found: ${options.db}`);
  if (guarded) verifyDailyJobPrepLock(options.db, options["lock-token"]);
  const db = new Database(options.db, { readonly: true, fileMustExist: true });
  try {
    assertCurrentOpportunitySchema(db);
    const opportunity = db.prepare("SELECT * FROM opportunities WHERE id=?").get(options["opportunity-id"]);
    if (!opportunity) throw new Error("Job opportunity not found");
    if (opportunity.type !== "job") throw new Error("Dossiers can only be inspected for job opportunities");
    if (guarded && (opportunity.status !== options["expected-status"] || opportunity.updated_at !== options["expected-updated-at"])) throw new Error("Opportunity status or version no longer matches expected snapshot");
    const artifacts = db.prepare("SELECT * FROM opportunity_artifacts WHERE opportunity_id=? ORDER BY updated_at DESC, created_at DESC, id DESC").all(opportunity.id);
    const requirements = REQUIREMENTS.map((requirement) => {
      const candidates = artifacts.filter((a) => a.type === requirement.type && (!requirement.requiredTitle || a.title === requirement.requiredTitle));
      const evaluated = candidates.map((artifact) => ({ artifact, assessment: assess(artifact.file_path) }));
      const selected = evaluated.find((entry) => entry.assessment.valid) || evaluated[0];
      const assessment = selected?.assessment || { absolutePath: false, exists: false, regularFile: false, valid: false };
      return { key: requirement.key, type: requirement.type, requiredTitle: requirement.requiredTitle, registered: candidates.length > 0, artifact: selected ? { id: selected.artifact.id, title: selected.artifact.title, filePath: selected.artifact.file_path, contentType: selected.artifact.content_type, updatedAt: selected.artifact.updated_at } : null, ...assessment };
    });
    return { schemaVersion: 1, opportunity: { id: opportunity.id, type: opportunity.type, label: opportunity.label, organization: opportunity.organization, status: opportunity.status, updatedAt: opportunity.updated_at }, inactive: ["archived", "rejected"].includes(opportunity.status), complete: requirements.every((r) => r.valid), tailoredResumeUrl: null, requirements };
  } finally { db.close(); }
}
function main() { process.stdout.write(`${JSON.stringify(inspectJobDossier(parse(process.argv.slice(2))), null, 2)}\n`); }
if (import.meta.url === `file://${process.argv[1]}`) try { main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); }
