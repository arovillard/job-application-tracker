import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "..");
const codexRoot = path.join(projectRoot, "skills", "daily-job-discovery-setup");
const claudeRoot = path.join(projectRoot, ".claude", "skills", "daily-job-discovery-setup");

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(path.join(root, entry.name)).map((name) => path.join(entry.name, name))
      : [entry.name]
  ).sort();
}

function inOrder(contents: string, tokens: string[]) {
  let cursor = -1;
  for (const token of tokens) {
    const index = contents.indexOf(token, cursor + 1);
    expect(index, `missing or out-of-order token: ${token}`).toBeGreaterThan(cursor);
    cursor = index;
  }
}

describe("daily job discovery setup skill", () => {
  it("ships a complete byte-identical skill for Codex and Claude", () => {
    expect(existsSync(path.join(codexRoot, "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(claudeRoot, "SKILL.md"))).toBe(true);
    expect(files(claudeRoot)).toEqual(files(codexRoot));
    for (const filename of files(codexRoot)) {
      expect(readFileSync(path.join(claudeRoot, filename))).toEqual(readFileSync(path.join(codexRoot, filename)));
    }
  });

  it("orders readiness, confirmed suggestions, private persistence, scheduling, and verification", () => {
    const skill = readFileSync(path.join(codexRoot, "SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\nname: daily-job-discovery-setup\ndescription: Use when /);
    inOrder(skill.toLowerCase(), [
      "check-application-readiness.mjs",
      "read-only",
      "suggest",
      "confirm",
      "jobtracker-database-identity.mjs initialize",
      "configure-daily-discovery.mjs",
      "skills:install",
      "check-daily-discovery-readiness.mjs",
      "create or update the one local task",
      "run now"
    ].map((token) => token.toLowerCase()));
  });

  it("defines private-data and database-reuse boundaries", () => {
    const skill = readFileSync(path.join(codexRoot, "SKILL.md"), "utf8");
    for (const required of [
      "data/job-discovery.json",
      "ignored",
      "structured preferences",
      "raw resume",
      ".env.local",
      "existing JobTracker database",
      "never create",
      "localhost:3000",
      "one active schedule"
    ]) expect(skill.toLowerCase()).toContain(required.toLowerCase());
  });

  it("requires both 80 percent gates and preserves no-submit authority", () => {
    const skill = readFileSync(path.join(codexRoot, "SKILL.md"), "utf8");
    expect(skill).toContain("overall match threshold");
    expect(skill).toContain("qualification match threshold");
    expect(skill).toContain("at least 80");
    for (const prohibited of ["sign in", "upload", "fill forms", "attest", "send messages", "submit"])
      expect(skill.toLowerCase()).toContain(`never ${prohibited}`);
  });

  it("documents durable local adapters and honest unsupported-host fallback", () => {
    const reference = readFileSync(path.join(codexRoot, "references", "schedulers.md"), "utf8");
    for (const required of [
      "ChatGPT Desktop",
      "Claude Desktop",
      "local",
      "computer",
      "desktop app",
      "one scheduler owner",
      "Do not use `/loop`",
      "Scheduled",
      "unsupported",
      "do not claim"
    ]) expect(reference).toContain(required);
    expect(reference).toContain("Daily qualified job preparation");
    expect(reference).toContain("disable every duplicate");
    expect(reference).toContain("non-owner");
  });

  it("routes setup intent from both repository instruction files", () => {
    const agents = readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
    const claude = readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8");
    expect(agents).toContain("skills/daily-job-discovery-setup/SKILL.md");
    expect(agents).toContain("$daily-job-discovery-setup");
    expect(claude).toContain(".claude/skills/daily-job-discovery-setup/SKILL.md");
    expect(claude).toContain("/daily-job-discovery-setup");
  });

  it("publishes the exact copyable setup prompt in both setup documents", () => {
    const readme = readFileSync(path.join(projectRoot, "README.md"), "utf8");
    const setup = readFileSync(path.join(projectRoot, "docs", "agent-setup.md"), "utf8");
    for (const contents of [readme, setup]) {
      expect(contents).toContain("Set up daily qualified job discovery for this JobTracker project.");
      expect(contents).toContain("Use the repository's daily-job-discovery-setup skill.");
      expect(contents).toContain("If I use both, help me choose one agent to own the active schedule");
      expect(contents).toContain("Never submit an application on my behalf.");
    }
  });
});
