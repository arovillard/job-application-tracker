import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error JavaScript production module intentionally has no declaration file.
import { DAILY_DISCOVERY_CONFIG_PATH, DAILY_DISCOVERY_SCHEDULED_PROMPT, evaluateDailyDiscoveryReadiness, readDailyDiscoveryConfig, validateDailyDiscoveryConfig, writeDailyDiscoveryConfig } from "./lib/daily-discovery-config.mjs";

const roots: string[] = [];
const databaseInstanceId = "123e4567-e89b-42d3-a456-426614174000";

function validConfig(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    enabled: true,
    schedule: {
      localTime: "08:15",
      timezone: "Etc/UTC",
      schedulerOwner: "codex"
    },
    agents: ["codex", "claude"],
    targets: {
      roleFamilies: ["Software delivery leadership"],
      seniorityLevels: ["manager", "director"],
      adjacentScope: ["platform leadership"],
      exclusions: ["internship"]
    },
    locationPolicy: {
      jurisdictions: ["Example Country"],
      remote: "allowed_when_explicitly_eligible",
      onsiteOrHybridLocations: ["Example City"],
      relocation: "not_offered",
      maximumTravelPercent: 20
    },
    qualificationPolicy: {
      workAuthorization: ["Example Country"],
      requiredCredentials: [],
      languages: ["Example Language"],
      hardConstraints: ["No unsupported mandatory credential"]
    },
    thresholds: {
      overallMatch: 80,
      qualificationMatch: 80,
      seniorityMatch: 75
    },
    databaseInstanceId,
    ...overrides
  };
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "jobtracker-daily-config-"));
  roots.push(root);
  mkdirSync(path.join(root, "data"), { recursive: true });
  writeFileSync(path.join(root, ".gitignore"), "data/job-discovery.json\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) execFileSync("rm", ["-rf", root]);
});

describe("daily discovery configuration", () => {
  it.each([
    [["codex"], "codex"],
    [["claude"], "claude"],
    [["codex", "claude"], "codex"],
    [["codex", "claude"], "claude"]
  ])("accepts installed agents %j with one %s scheduler owner", (agents, schedulerOwner) => {
    const result = validateDailyDiscoveryConfig(validConfig({
      agents,
      schedule: { localTime: "08:15", timezone: "Etc/UTC", schedulerOwner }
    }));
    expect(result.agents).toEqual(agents);
    expect(result.schedule.schedulerOwner).toBe(schedulerOwner);
  });

  it.each([
    ["threshold below overall floor", { thresholds: { overallMatch: 79, qualificationMatch: 80, seniorityMatch: 75 } }],
    ["threshold below qualification floor", { thresholds: { overallMatch: 80, qualificationMatch: 79, seniorityMatch: 75 } }],
    ["invalid time", { schedule: { localTime: "25:00", timezone: "Etc/UTC", schedulerOwner: "codex" } }],
    ["invalid timezone", { schedule: { localTime: "08:15", timezone: "Not/AZone", schedulerOwner: "codex" } }],
    ["owner not installed", { agents: ["claude"], schedule: { localTime: "08:15", timezone: "Etc/UTC", schedulerOwner: "codex" } }],
    ["empty targeting", { targets: { roleFamilies: [], seniorityLevels: [], adjacentScope: [], exclusions: [] } }],
    ["unknown key", { rawResumeText: "private contents" }],
    ["invalid identity", { databaseInstanceId: "not-a-uuid" }]
  ])("rejects %s", (_label, override) => {
    expect(() => validateDailyDiscoveryConfig(validConfig(override))).toThrow();
  });

  it("writes only to the exact ignored path with private permissions", () => {
    const root = fixture();
    const result = writeDailyDiscoveryConfig(root, validConfig());
    const filename = path.join(root, DAILY_DISCOVERY_CONFIG_PATH);

    expect(result.path).toBe(filename);
    expect(statSync(filename).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(filename, "utf8"))).toEqual(result.config);
    expect(readDailyDiscoveryConfig(root)).toEqual(result.config);
  });

  it("refuses an unignored destination", () => {
    const root = fixture();
    writeFileSync(path.join(root, ".gitignore"), "");
    expect(() => writeDailyDiscoveryConfig(root, validConfig())).toThrow(/ignored by Git/i);
  });

  it("preserves the previous valid file when replacement fails", () => {
    const root = fixture();
    writeDailyDiscoveryConfig(root, validConfig());
    const filename = path.join(root, DAILY_DISCOVERY_CONFIG_PATH);
    const before = readFileSync(filename, "utf8");

    expect(() => writeDailyDiscoveryConfig(root, validConfig({ enabled: false }), {
      rename() {
        throw new Error("simulated rename failure");
      }
    })).toThrow("simulated rename failure");
    expect(readFileSync(filename, "utf8")).toBe(before);
  });

  it("restores owner-only permissions when replacing an existing file", () => {
    const root = fixture();
    writeDailyDiscoveryConfig(root, validConfig());
    const filename = path.join(root, DAILY_DISCOVERY_CONFIG_PATH);
    chmodSync(filename, 0o644);
    writeDailyDiscoveryConfig(root, validConfig({ enabled: false }));
    expect(statSync(filename).mode & 0o777).toBe(0o600);
  });

  it("uses a provider-neutral scheduled prompt with no private profile values", () => {
    expect(DAILY_DISCOVERY_SCHEDULED_PROMPT).toContain("Daily Qualified Discovery Mode");
    expect(DAILY_DISCOVERY_SCHEDULED_PROMPT).toContain("check-daily-discovery-readiness.mjs");
    for (const forbidden of ["Example City", "Example Country", databaseInstanceId, "08:15", "Etc/UTC", "/Users/"]) {
      expect(DAILY_DISCOVERY_SCHEDULED_PROMPT).not.toContain(forbidden);
    }
  });

  it("emits a provider-neutral stable task identity for idempotent reconciliation", () => {
    const root = fixture();
    writeDailyDiscoveryConfig(root, validConfig());
    const result = evaluateDailyDiscoveryReadiness({ projectRoot: root }, {
      evaluateApplicationReadiness: () => ({
        status: "ready",
        projectRoot: root,
        database: { path: path.join(root, "data", "jobtracker.sqlite") },
        skills: { repositoryComplete: true, codexInstalled: true, claudeInstalled: true }
      }),
      verifyDatabaseIdentity: () => ({ action: "verified", instanceId: databaseInstanceId })
    });

    expect(result.scheduler).toMatchObject({
      taskKey: "daily-qualified-job-preparation",
      taskName: "Daily qualified job preparation"
    });
  });

  it("fails readiness closed when the profile identity does not verify", () => {
    const root = fixture();
    writeDailyDiscoveryConfig(root, validConfig());
    const result = evaluateDailyDiscoveryReadiness({ projectRoot: root }, {
      evaluateApplicationReadiness: () => ({
        status: "ready",
        projectRoot: root,
        database: { path: path.join(root, "data", "jobtracker.sqlite") },
        skills: { repositoryComplete: true, codexInstalled: true, claudeInstalled: true }
      }),
      verifyDatabaseIdentity: () => {
        throw new Error("database identity does not match");
      }
    });

    expect(result.status).toBe("blocked");
    expect(result.blockingIssues).toContain("database_identity_invalid");
    expect(result).not.toHaveProperty("privateConfig");
  });

  it("returns the full local profile only when explicitly requested", () => {
    const root = fixture();
    writeDailyDiscoveryConfig(root, validConfig());
    const operations = {
      evaluateApplicationReadiness: () => ({
        status: "ready",
        projectRoot: root,
        database: { path: path.join(root, "data", "jobtracker.sqlite") },
        skills: { repositoryComplete: true, codexInstalled: true, claudeInstalled: true }
      }),
      verifyDatabaseIdentity: () => ({ action: "verified", instanceId: databaseInstanceId })
    };

    const redacted = evaluateDailyDiscoveryReadiness({ projectRoot: root }, operations);
    const full = evaluateDailyDiscoveryReadiness({ projectRoot: root, includePrivateConfig: true }, operations);

    expect(redacted.status).toBe("ready");
    expect(redacted.discovery).toMatchObject({ configured: true, valid: true, schedulerOwner: "codex" });
    expect(redacted).not.toHaveProperty("privateConfig");
    expect(full.privateConfig).toEqual(validateDailyDiscoveryConfig(validConfig()));
  });
});
