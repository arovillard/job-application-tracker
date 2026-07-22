import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const CATEGORY_WEIGHTS = new Map([
  ["required_qualifications", 50],
  ["seniority_leadership", 20],
  ["technical_domain", 15],
  ["product_delivery_customer", 10],
  ["logistics_employment", 5]
]);
const CREDIT = { direct: 1, adjacent: 0.5, unsupported: 0 };
const display = value => Number(value.toFixed(1));

function fail(message) {
  throw new Error(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string`);
}

function validate(input) {
  object(input, "input");
  if (input.schemaVersion !== SCHEMA_VERSION) fail("schemaVersion must be 1");

  const posting = object(input.posting, "posting");
  for (const field of ["url", "organization", "role", "source", "state", "evaluatedAt"]) nonEmptyString(posting[field], `posting.${field}`);
  if (typeof posting.location !== "string") fail("posting.location must be a string");
  if (!["open", "closed", "unknown"].includes(posting.state)) fail("posting.state must be open, closed, or unknown");

  if (!Array.isArray(input.groups) || input.groups.length !== CATEGORY_WEIGHTS.size) fail("groups must contain exactly the required categories");
  const groups = new Map();
  for (const group of input.groups) {
    object(group, "group");
    nonEmptyString(group.name, "group.name");
    if (groups.has(group.name)) fail(`duplicate category: ${group.name}`);
    if (!CATEGORY_WEIGHTS.has(group.name)) fail(`unknown category: ${group.name}`);
    if (!Array.isArray(group.criteria)) fail(`criteria for ${group.name} must be an array`);
    let total = 0;
    for (const item of group.criteria) {
      object(item, "criterion");
      nonEmptyString(item.id, "criterion.id");
      nonEmptyString(item.requirement, "criterion.requirement");
      nonEmptyString(item.rationale, "criterion.rationale");
      if (typeof item.mandatory !== "boolean") fail("criterion.mandatory must be a boolean");
      if (!Object.hasOwn(CREDIT, item.evidence)) fail("criterion.evidence is invalid");
      if ((item.evidence === "direct" || item.evidence === "adjacent")) nonEmptyString(item.evidenceText, "criterion.evidenceText");
      if (!Number.isInteger(item.weight) || item.weight <= 0) fail("criterion.weight must be a positive integer");
      total += item.weight;
    }
    if (total !== CATEGORY_WEIGHTS.get(group.name)) fail(`criteria for ${group.name} must sum to ${CATEGORY_WEIGHTS.get(group.name)}`);
    groups.set(group.name, group);
  }
  if (groups.size !== CATEGORY_WEIGHTS.size) fail("groups must contain exactly the required categories");

  if (!Array.isArray(input.blockers)) fail("blockers must be an array");
  for (const blocker of input.blockers) {
    object(blocker, "blocker");
    nonEmptyString(blocker.code, "blocker.code");
    nonEmptyString(blocker.requirement, "blocker.requirement");
    nonEmptyString(blocker.evidence, "blocker.evidence");
  }

  const criteria = [...groups.values()].flatMap(group => group.criteria);
  const mandatory = criteria.filter(item => item.mandatory);
  if (!mandatory.length) fail("at least one mandatory criterion is required");
  return { posting, groups, criteria, mandatory, blockers: input.blockers };
}

function earnedHalfUnits(item) {
  return item.weight * 2 * CREDIT[item.evidence];
}

export function evaluateJobMatch(input) {
  const { posting, groups, criteria, mandatory, blockers } = validate(input);
  const overallHalfUnits = criteria.reduce((sum, item) => sum + earnedHalfUnits(item), 0);
  const mandatoryAvailableHalfUnits = mandatory.reduce((sum, item) => sum + item.weight * 2, 0);
  const mandatoryEarnedHalfUnits = mandatory.reduce((sum, item) => sum + earnedHalfUnits(item), 0);
  const seniority = groups.get("seniority_leadership").criteria;
  const seniorityEarnedHalfUnits = seniority.reduce((sum, item) => sum + earnedHalfUnits(item), 0);
  const overallExact = overallHalfUnits / 2;
  const mandatoryExact = mandatoryEarnedHalfUnits * 100 / mandatoryAvailableHalfUnits;
  const seniorityExact = seniorityEarnedHalfUnits * 100 / (20 * 2);
  const reasons = [];
  if (posting.state !== "open") reasons.push({ code: "posting_not_open", message: "Posting is not open." });
  if (overallExact < 80) reasons.push({ code: "overall_below_threshold", message: `Overall score ${display(overallExact)} is below 80.` });
  if (mandatoryExact < 80) reasons.push({ code: "mandatory_below_threshold", message: `Mandatory match ${display(mandatoryExact)} is below 80.` });
  if (seniorityExact < 75) reasons.push({ code: "seniority_below_threshold", message: `Seniority match ${display(seniorityExact)} is below 75.` });
  if (blockers.length) reasons.push({ code: "non_negotiable_blocker", message: "A non-negotiable blocker is present." });

  const categoryScores = {};
  for (const [name, available] of CATEGORY_WEIGHTS) {
    const earned = groups.get(name).criteria.reduce((sum, item) => sum + earnedHalfUnits(item), 0) / 2;
    categoryScores[name] = { available: display(available), earned: display(earned) };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    overallScore: display(overallExact),
    mandatoryMatch: display(mandatoryExact),
    seniorityMatch: display(seniorityExact),
    eligible: reasons.length === 0,
    reasons,
    categoryScores
  };
}

function parseArguments(args) {
  if (args.length !== 2 || args[0] !== "--input-json" || !args[1]) fail("usage: evaluate-job-match.mjs --input-json <path|->");
  return args[1];
}

function main() {
  const inputPath = parseArguments(process.argv.slice(2));
  const source = inputPath === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(inputPath, "utf8");
  let input;
  try {
    input = JSON.parse(source);
  } catch {
    fail("input must be valid JSON");
  }
  process.stdout.write(`${JSON.stringify(evaluateJobMatch(input))}\n`);
}

const entrypoint = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href;
if (entrypoint === import.meta.url) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
