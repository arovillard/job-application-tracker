#!/usr/bin/env node
import { constants, copyFileSync, existsSync, lstatSync, readFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { REQUIREMENTS, inspectJobDossier } from "./inspect-job-dossier.mjs";
import { registerApplicationArtifact } from "./register-application-artifact.mjs";

const requirementByKey = new Map(REQUIREMENTS.map((item) => [item.key, item]));
function inside(child, parent) { return child === parent || child.startsWith(`${parent}${path.sep}`); }

function manifestValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1 || !Array.isArray(value.entries) || Object.keys(value).length !== 2) {
    throw new Error("Invalid dossier manifest");
  }
  return value;
}

function validateManifestEntry(entry, context) {
  const allowedKeys = ["key", "stagedFile", "destinationFile", "contentType"];
  if (!entry || typeof entry !== "object" || Object.keys(entry).some((key) => !allowedKeys.includes(key)) || !requirementByKey.has(entry.key) || context.keys.has(entry.key) || typeof entry.stagedFile !== "string" || typeof entry.destinationFile !== "string" || typeof entry.contentType !== "string") {
    throw new Error("Invalid dossier manifest entry");
  }
  context.keys.add(entry.key);
  const requirement = context.inspection.requirements.find((item) => item.key === entry.key);
  if (requirement.valid) throw new Error(`Manifest attempts to replace valid requirement: ${entry.key}`);
  if (!existsSync(entry.stagedFile) || !lstatSync(entry.stagedFile).isFile()) throw new Error("Staged source must be a regular file");
  const stagedFile = realpathSync(entry.stagedFile);
  if (!inside(stagedFile, context.stagingDirectory) || stagedFile === context.stagingDirectory) throw new Error("Staged file must remain inside applications staging directory");

  const destinationFile = path.normalize(entry.destinationFile);
  const duplicateDestination = [...context.entries.values()].some((value) => value.destinationFile === destinationFile);
  if (!path.isAbsolute(entry.destinationFile) || existsSync(entry.destinationFile) || duplicateDestination) throw new Error("Destination file must be absolute, unique, and must not exist");
  const immediateParent = path.dirname(destinationFile);
  if (!existsSync(immediateParent)) throw new Error("Destination immediate parent must exist");
  const destinationParent = realpathSync(immediateParent);
  const exactDestination = destinationFile === path.join(immediateParent, path.basename(destinationFile));
  if (!inside(destinationParent, context.applicationsDirectory) || inside(destinationParent, context.stagingDirectory) || !exactDestination) {
    throw new Error("Destination file must remain inside applications directory outside staging");
  }
  return { ...entry, stagedFile, destinationFile };
}

function assertDestinationsUnregistered(databasePath, entries) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    for (const entry of entries.values()) {
      if (db.prepare("SELECT 1 FROM opportunity_artifacts WHERE file_path=?").get(entry.destinationFile)) {
        throw new Error(`Destination is already registered: ${entry.destinationFile}`);
      }
    }
  } finally {
    db.close();
  }
}

function exactArtifactExists(databasePath, opportunityId, entry, requirement) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return Boolean(db.prepare("SELECT 1 FROM opportunity_artifacts WHERE opportunity_id=? AND type=? AND title=? AND file_path=?").get(opportunityId, requirement.type, requirement.requiredTitle || requirement.key, entry.destinationFile));
  } finally {
    db.close();
  }
}

function currentUpdatedAt(databasePath, opportunityId) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("SELECT updated_at FROM opportunities WHERE id=?").get(opportunityId).updated_at;
  } finally {
    db.close();
  }
}
export function commitJobDossier(options, dependencies = {}) {
  for (const key of ["db", "opportunity-id", "applications-dir", "lock-token", "expected-status", "expected-updated-at", "manifest"]) if (!options[key]) throw new Error(`${key} is required`);
  if (options["expected-status"] !== "wishlist" || !path.isAbsolute(options.db) || !path.isAbsolute(options["applications-dir"])) throw new Error("Invalid guarded dossier options");
  const applicationsDir = realpathSync(options["applications-dir"]), stagingDir = realpathSync(path.join(applicationsDir, ".staging"));
  if (!inside(stagingDir, applicationsDir) || stagingDir === applicationsDir) throw new Error("Staging directory must be a strict descendant of applications directory");
  const manifest = manifestValue(options.manifest), inspectionOptions = { db: options.db, "opportunity-id": options["opportunity-id"], "lock-token": options["lock-token"], "expected-status": options["expected-status"], "expected-updated-at": options["expected-updated-at"] };
  let inspection = (dependencies.inspect || inspectJobDossier)(inspectionOptions);
  const invalid = inspection.requirements.filter((item) => !item.valid);
  if (manifest.entries.length !== invalid.length) throw new Error("Manifest must contain exactly the missing dossier requirements");
  const keys = new Set();
  const entries = new Map();
  for (const entry of manifest.entries) {
    entries.set(entry.key, validateManifestEntry(entry, {
      applicationsDirectory: applicationsDir,
      stagingDirectory: stagingDir,
      inspection,
      keys,
      entries
    }));
  }
  for (const requirement of invalid) if (!entries.has(requirement.key)) throw new Error(`Missing dossier manifest entry: ${requirement.key}`);
  assertDestinationsUnregistered(options.db, entries);

  let expectedUpdatedAt = options["expected-updated-at"];
  for (const requirement of REQUIREMENTS) {
    const entry = entries.get(requirement.key);
    if (!entry) continue;
    copyFileSync(entry.stagedFile, entry.destinationFile, constants.COPYFILE_EXCL);
    try {
      dependencies.beforeRegister?.(requirement, entry);
      (dependencies.register || registerApplicationArtifact)({ db: options.db, "opportunity-id": options["opportunity-id"], type: requirement.type, title: requirement.requiredTitle || requirement.key, file: entry.destinationFile, "content-type": entry.contentType, "lock-token": options["lock-token"], "expected-status": options["expected-status"] });
    } catch (error) {
      if (!exactArtifactExists(options.db, options["opportunity-id"], entry, requirement)) {
        rmSync(entry.destinationFile, { force: true });
        throw error;
      }
    }
    rmSync(entry.stagedFile, { force: true });
    expectedUpdatedAt = currentUpdatedAt(options.db, options["opportunity-id"]);
  }
  const result = (dependencies.inspect || inspectJobDossier)({ ...inspectionOptions, "expected-updated-at": expectedUpdatedAt });
  if (!result.complete) throw new Error("Dossier remains incomplete after commit");
  return result;
}
function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--") || Object.hasOwn(values, flag.slice(2))) throw new Error("Invalid command arguments");
    values[flag.slice(2)] = value;
  }
  const allowed = new Set(["db", "opportunity-id", "applications-dir", "lock-token", "expected-status", "expected-updated-at", "manifest-json"]);
  if (Object.keys(values).some((key) => !allowed.has(key))) throw new Error("Invalid command arguments");
  return values;
}

function main() {
  const input = parseArguments(process.argv.slice(2));
  const raw = input["manifest-json"] === "-" ? readFileSync(0, "utf8") : readFileSync(input["manifest-json"], "utf8");
  const result = commitJobDossier({ ...input, manifest: JSON.parse(raw) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (import.meta.url === `file://${process.argv[1]}`) try { main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); }
