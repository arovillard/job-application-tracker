import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { evaluateApplicationReadiness as defaultEvaluateApplicationReadiness } from "./application-readiness.mjs";
import { verifyDatabaseIdentity as defaultVerifyDatabaseIdentity } from "./jobtracker-database-identity.mjs";

export const DAILY_DISCOVERY_CONFIG_PATH = path.join("data", "job-discovery.json");
export const DAILY_DISCOVERY_TASK_KEY = "daily-qualified-job-preparation";
export const DAILY_DISCOVERY_TASK_NAME = "Daily qualified job preparation";
export const DAILY_DISCOVERY_SCHEDULED_PROMPT = [
  "Use the repository's job-application-workflow skill in Daily Qualified Discovery Mode.",
  "Begin with node scripts/check-daily-discovery-readiness.mjs --include-private-config and follow the repository coordinator exactly.",
  "Use only the returned existing database and ignored applications directory, prepare only eligible dossiers, and never submit an application."
].join(" ");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFIG_KEYS = [
  "schemaVersion",
  "enabled",
  "schedule",
  "agents",
  "targets",
  "locationPolicy",
  "qualificationPolicy",
  "thresholds",
  "databaseInstanceId"
];

function assertObject(value, label, allowedKeys) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) throw new Error(`${label} contains unsupported key: ${key}`);
  }
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${label}.${key} is required`);
  }
  return value;
}

function stringArray(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  const normalized = [...new Set(value.map((item) => item.trim()))];
  if (!allowEmpty && normalized.length === 0) throw new Error(`${label} must not be empty`);
  return normalized;
}

function integer(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function oneOf(value, label, values) {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${label} must be one of: ${values.join(", ")}`);
  }
  return value;
}

function validTimezone(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.trim() }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function validateDailyDiscoveryConfig(input) {
  const value = assertObject(input, "configuration", CONFIG_KEYS);
  if (value.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (typeof value.enabled !== "boolean") throw new Error("enabled must be a boolean");

  const schedule = assertObject(value.schedule, "schedule", ["localTime", "timezone", "schedulerOwner"]);
  if (typeof schedule.localTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime)) {
    throw new Error("schedule.localTime must use 24-hour HH:MM format");
  }
  if (!validTimezone(schedule.timezone)) throw new Error("schedule.timezone must be a valid IANA timezone");

  const agents = stringArray(value.agents, "agents", { allowEmpty: false });
  if (agents.some((agent) => !["codex", "claude"].includes(agent))) {
    throw new Error("agents may contain only codex and claude");
  }
  const schedulerOwner = oneOf(schedule.schedulerOwner, "schedule.schedulerOwner", ["codex", "claude"]);
  if (!agents.includes(schedulerOwner)) throw new Error("schedule.schedulerOwner must identify an installed agent");

  const targets = assertObject(value.targets, "targets", [
    "roleFamilies",
    "seniorityLevels",
    "adjacentScope",
    "exclusions"
  ]);
  const roleFamilies = stringArray(targets.roleFamilies, "targets.roleFamilies");
  const seniorityLevels = stringArray(targets.seniorityLevels, "targets.seniorityLevels");
  const adjacentScope = stringArray(targets.adjacentScope, "targets.adjacentScope");
  const exclusions = stringArray(targets.exclusions, "targets.exclusions");
  if (roleFamilies.length === 0 || seniorityLevels.length === 0) {
    throw new Error("targets must include at least one role family and seniority level");
  }
  const included = new Set([...roleFamilies, ...seniorityLevels, ...adjacentScope].map((item) => item.toLowerCase()));
  if (exclusions.some((item) => included.has(item.toLowerCase()))) {
    throw new Error("targets cannot include and exclude the same value");
  }

  const locationPolicy = assertObject(value.locationPolicy, "locationPolicy", [
    "jurisdictions",
    "remote",
    "onsiteOrHybridLocations",
    "relocation",
    "maximumTravelPercent"
  ]);
  const jurisdictions = stringArray(locationPolicy.jurisdictions, "locationPolicy.jurisdictions", { allowEmpty: false });
  const onsiteOrHybridLocations = stringArray(
    locationPolicy.onsiteOrHybridLocations,
    "locationPolicy.onsiteOrHybridLocations"
  );
  const remote = oneOf(locationPolicy.remote, "locationPolicy.remote", [
    "allowed_when_explicitly_eligible",
    "required",
    "not_allowed"
  ]);
  const relocation = oneOf(locationPolicy.relocation, "locationPolicy.relocation", [
    "allowed",
    "not_offered",
    "required"
  ]);

  const qualificationPolicy = assertObject(value.qualificationPolicy, "qualificationPolicy", [
    "workAuthorization",
    "requiredCredentials",
    "languages",
    "hardConstraints"
  ]);
  const workAuthorization = stringArray(
    qualificationPolicy.workAuthorization,
    "qualificationPolicy.workAuthorization"
  );
  const requiredCredentials = stringArray(
    qualificationPolicy.requiredCredentials,
    "qualificationPolicy.requiredCredentials"
  );
  const languages = stringArray(qualificationPolicy.languages, "qualificationPolicy.languages");
  const hardConstraints = stringArray(
    qualificationPolicy.hardConstraints,
    "qualificationPolicy.hardConstraints"
  );

  const thresholds = assertObject(value.thresholds, "thresholds", [
    "overallMatch",
    "qualificationMatch",
    "seniorityMatch"
  ]);
  const overallMatch = integer(thresholds.overallMatch, "thresholds.overallMatch", 80, 100);
  const qualificationMatch = integer(thresholds.qualificationMatch, "thresholds.qualificationMatch", 80, 100);
  const seniorityMatch = integer(thresholds.seniorityMatch, "thresholds.seniorityMatch", 75, 100);
  if (typeof value.databaseInstanceId !== "string" || !UUID.test(value.databaseInstanceId)) {
    throw new Error("databaseInstanceId must be a UUID");
  }

  return {
    schemaVersion: 1,
    enabled: value.enabled,
    schedule: {
      localTime: schedule.localTime,
      timezone: schedule.timezone.trim(),
      schedulerOwner
    },
    agents,
    targets: { roleFamilies, seniorityLevels, adjacentScope, exclusions },
    locationPolicy: {
      jurisdictions,
      remote,
      onsiteOrHybridLocations,
      relocation,
      maximumTravelPercent: integer(
        locationPolicy.maximumTravelPercent,
        "locationPolicy.maximumTravelPercent",
        0,
        100
      )
    },
    qualificationPolicy: { workAuthorization, requiredCredentials, languages, hardConstraints },
    thresholds: { overallMatch, qualificationMatch, seniorityMatch },
    databaseInstanceId: value.databaseInstanceId.toLowerCase()
  };
}

function configFilename(projectRoot) {
  return path.join(path.resolve(projectRoot), DAILY_DISCOVERY_CONFIG_PATH);
}

function assertIgnored(projectRoot, filename) {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", filename], {
      cwd: path.resolve(projectRoot),
      stdio: "ignore"
    });
  } catch {
    throw new Error(`${DAILY_DISCOVERY_CONFIG_PATH} must be ignored by Git before it can store private preferences`);
  }
}

export function writeDailyDiscoveryConfig(projectRoot, input, operations = {}) {
  const root = path.resolve(projectRoot);
  const config = validateDailyDiscoveryConfig(input);
  const filename = configFilename(root);
  assertIgnored(root, filename);
  mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = path.join(path.dirname(filename), `.job-discovery.json.tmp-${process.pid}-${randomUUID()}`);
  const rename = operations.rename ?? renameSync;
  const remove = operations.unlink ?? unlinkSync;
  try {
    writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    chmodSync(temporary, 0o600);
    rename(temporary, filename);
    chmodSync(filename, 0o600);
  } catch (error) {
    try {
      if (existsSync(temporary)) remove(temporary);
    } catch {
      // Preserve the original error; cleanup is best effort.
    }
    throw error;
  }
  return { schemaVersion: 1, path: filename, config };
}

export function readDailyDiscoveryConfig(projectRoot) {
  const filename = configFilename(projectRoot);
  if (!existsSync(filename)) throw new Error("daily discovery profile is not configured");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filename, "utf8"));
  } catch (error) {
    throw new Error(`daily discovery profile is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateDailyDiscoveryConfig(parsed);
}

function unique(values) {
  return [...new Set(values)];
}

export function evaluateDailyDiscoveryReadiness(options, operations = {}) {
  const root = path.resolve(options.projectRoot);
  const evaluateApplicationReadiness = operations.evaluateApplicationReadiness ?? defaultEvaluateApplicationReadiness;
  const verifyDatabaseIdentity = operations.verifyDatabaseIdentity ?? defaultVerifyDatabaseIdentity;
  const application = evaluateApplicationReadiness({
    projectRoot: root,
    processEnv: options.processEnv,
    codexHome: options.codexHome,
    claudeHome: options.claudeHome
  });
  const blockingIssues = application.status === "blocked" ? ["application_readiness_blocked"] : [];
  const inputIssues = application.status === "needs_input" ? ["application_readiness_needs_input"] : [];
  let config = null;
  try {
    config = readDailyDiscoveryConfig(root);
  } catch {
    inputIssues.push(existsSync(configFilename(root)) ? "discovery_profile_invalid" : "discovery_profile_missing");
  }

  let identityVerified = false;
  if (application.status === "ready" && config) {
    try {
      verifyDatabaseIdentity(application.database.path, config.databaseInstanceId);
      identityVerified = true;
    } catch {
      blockingIssues.push("database_identity_invalid");
    }
    if (config.agents.includes("codex") && !application.skills.codexInstalled) {
      inputIssues.push("codex_skills_not_installed");
    }
    if (config.agents.includes("claude") && !application.skills.claudeInstalled) {
      inputIssues.push("claude_skills_not_installed");
    }
  }

  const blockers = unique(blockingIssues);
  const needsInput = unique(inputIssues);
  const result = {
    schemaVersion: 1,
    status: blockers.length ? "blocked" : needsInput.length ? "needs_input" : "ready",
    projectRoot: root,
    application,
    discovery: config
      ? {
          configured: true,
          valid: true,
          enabled: config.enabled,
          schedulerOwner: config.schedule.schedulerOwner,
          agents: config.agents,
          identityVerified
        }
      : { configured: false, valid: false, identityVerified: false },
    scheduler: {
      taskKey: DAILY_DISCOVERY_TASK_KEY,
      taskName: DAILY_DISCOVERY_TASK_NAME,
      prompt: DAILY_DISCOVERY_SCHEDULED_PROMPT,
      localOnly: true,
      requiresComputerAwake: true,
      requiresDesktopAgentRunning: true
    },
    blockingIssues: blockers,
    inputIssues: needsInput
  };
  if (options.includePrivateConfig && config) result.privateConfig = config;
  return result;
}
