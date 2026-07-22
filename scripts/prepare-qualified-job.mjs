#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { evaluateJobMatch } from "./evaluate-job-match.mjs";
import { verifyDatabaseIdentity } from "./lib/jobtracker-database-identity.mjs";
import { verifyDailyJobPrepLock } from "./lib/daily-job-prep-lock.mjs";

const POSTING_KEYS = new Set(["company", "role", "url", "source", "location", "contact", "summary", "note", "posting_state"]);

function compact(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function canonicalUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.href;
  } catch {
    throw new Error("posting url must be a valid URL");
  }
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--") || Object.hasOwn(options, flag.slice(2))) {
      throw new Error("Invalid command arguments");
    }
    options[flag.slice(2)] = value;
  }
  const expected = ["db", "expected-database-id", "lock-token", "input-json"];
  if (Object.keys(options).length !== expected.length || !expected.every((key) => options[key]) || !path.isAbsolute(options.db)) {
    throw new Error("Invalid command arguments");
  }
  return options;
}

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2 || !Object.hasOwn(input, "assessment") || !Object.hasOwn(input, "posting")) {
    throw new Error("input must contain exactly assessment and posting");
  }
  if (!input.posting || typeof input.posting !== "object" || Array.isArray(input.posting) || Object.keys(input.posting).some((key) => !POSTING_KEYS.has(key))) {
    throw new Error("invalid posting input");
  }
  const posting = input.posting;
  for (const key of ["company", "role", "url", "posting_state"]) {
    if (!compact(posting[key])) throw new Error(`posting.${key} is required`);
  }
  if (!["open", "closed", "unknown"].includes(posting.posting_state)) throw new Error("posting_state is invalid");
  const evaluated = input.assessment?.posting;
  const matchesAssessment = evaluated
    && compact(posting.company) === compact(evaluated.organization)
    && compact(posting.role) === compact(evaluated.role)
    && canonicalUrl(posting.url) === canonicalUrl(evaluated.url)
    && posting.posting_state === evaluated.state;
  if (!matchesAssessment) throw new Error("posting facts must exactly match assessment");
  return posting;
}

function invoke(script, args, input) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    input: JSON.stringify(input)
  });
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `${script} failed`);
  return JSON.parse(result.stdout);
}

function inspectDossier(databasePath, opportunityId) {
  const result = spawnSync(process.execPath, [
    "scripts/inspect-job-dossier.mjs",
    "--db", databasePath,
    "--opportunity-id", opportunityId
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || "dossier inspection failed");
  return JSON.parse(result.stdout);
}

function output(decision, evaluation, opportunity = null, dossier = null, preparationPrecondition = null) {
  return { schemaVersion: 1, decision, evaluation, opportunity, dossier, preparationPrecondition };
}

function exactPrecondition(actual, expected) {
  return actual
    && actual.existed === expected.existed
    && actual.opportunityId === expected.opportunityId
    && actual.status === expected.status
    && actual.updatedAt === expected.updatedAt;
}

function nonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
}

function validateRealUpsert(result, action, posting, snapshot) {
  const expectedActivities = action === "created" ? 2 : 1;
  const expectedPrecondition = action === "created"
    ? { existed: false, opportunityId: null, status: null, updatedAt: null }
    : snapshot;
  const identityMatches = result?.opportunity?.type === "job"
    && result.opportunity.organization === compact(posting.company)
    && result.opportunity.label === compact(posting.role)
    && canonicalUrl(result.opportunity.url) === canonicalUrl(posting.url)
    && result.opportunity.status === "wishlist";
  const existingIdMatches = action === "created" || result.opportunity.id === snapshot.opportunityId;
  const activityShape = nonEmptyStringArray(result.activityIds) && result.activityIds.length === expectedActivities;
  const resultShape = result?.action === action
    && identityMatches
    && existingIdMatches
    && exactPrecondition(result.precondition, expectedPrecondition)
    && nonEmptyStringArray(result.changes)
    && activityShape
    && Array.isArray(result.taskIds)
    && result.taskIds.length === 0
    && typeof result.opportunity.updatedAt === "string"
    && result.opportunity.updatedAt.length > 0;
  if (!resultShape) throw new Error("invalid automated upsert result");
  return {
    opportunityId: result.opportunity.id,
    status: result.opportunity.status,
    updatedAt: result.opportunity.updatedAt
  };
}

function run() {
  const options = parseArguments(process.argv.slice(2));
  const raw = options["input-json"] === "-" ? readFileSync(0, "utf8") : readFileSync(options["input-json"], "utf8");
  const input = JSON.parse(raw);
  const posting = validateInput(input);
  verifyDatabaseIdentity(options.db, options["expected-database-id"]);
  verifyDailyJobPrepLock(options.db, options["lock-token"]);

  const evaluation = evaluateJobMatch(input.assessment);
  if (!evaluation.eligible) return output("skip_ineligible", evaluation);

  const baseArguments = [
    "--db", options.db,
    "--automation-mode",
    "--lock-token", options["lock-token"],
    "--input-json", "-"
  ];
  const dryRun = invoke("scripts/upsert-job-posting.mjs", [...baseArguments, "--dry-run"], posting);
  const snapshot = dryRun.precondition;
  if (snapshot.existed && ["rejected", "archived"].includes(snapshot.status)) {
    return output("skip_inactive", evaluation, dryRun.opportunity);
  }

  if (snapshot.existed) {
    const dossier = inspectDossier(options.db, snapshot.opportunityId);
    if (dossier.opportunity.status !== "wishlist" || snapshot.status !== "wishlist") {
      throw new Error("automated material preparation requires wishlist status");
    }
    const unchanged = Array.isArray(dryRun.changes) && dryRun.changes.length === 0;
    const repairPrecondition = {
      opportunityId: dossier.opportunity.id,
      status: dossier.opportunity.status,
      updatedAt: dossier.opportunity.updatedAt
    };
    if (unchanged && dossier.complete) return output("skip_complete", evaluation, dryRun.opportunity, dossier);
    if (unchanged) return output("repair_dossier", evaluation, dryRun.opportunity, dossier, repairPrecondition);

    const real = invoke("scripts/upsert-job-posting.mjs", [
      ...baseArguments,
      "--expected-opportunity-id", snapshot.opportunityId,
      "--expected-status", snapshot.status,
      "--expected-updated-at", snapshot.updatedAt
    ], posting);
    const preparationPrecondition = validateRealUpsert(real, "updated", posting, snapshot);
    return output("prepare_dossier", evaluation, real.opportunity, null, preparationPrecondition);
  }

  const real = invoke("scripts/upsert-job-posting.mjs", [...baseArguments, "--expect-new"], posting);
  const preparationPrecondition = validateRealUpsert(real, "created", posting, snapshot);
  return output("prepare_dossier", evaluation, real.opportunity, null, preparationPrecondition);
}

try {
  process.stdout.write(`${JSON.stringify(run())}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
