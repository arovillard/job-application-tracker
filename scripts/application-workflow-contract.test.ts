import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "..");
const workflow = readFileSync(path.join(projectRoot, "skills/job-application-workflow/SKILL.md"), "utf8");
const resumeSkill = readFileSync(path.join(projectRoot, "skills/job-application-resume/SKILL.md"), "utf8");
const postingSkill = readFileSync(path.join(projectRoot, "skills/job-tracker-add-posting/SKILL.md"), "utf8");
const readySentence = "Your application workspace is ready. Your master resume is configured and will not be modified. Send me a job-posting link when you're ready.";
const nextLinkSentence = "I'm ready for another job-posting link whenever you are.";
const successfulCompletionInstruction = `End the final response with exactly: “${nextLinkSentence}” Use this sentence only after tracker intake, verification, and all requested application-material work complete successfully. Do not use this sentence when the workflow is blocked, failed, incomplete, or awaiting user input.`;

function expectInOrder(content: string, tokens: string[]) {
  let cursor = -1;
  for (const token of tokens) {
    const next = content.indexOf(token, cursor + 1);
    expect(next, `missing or out-of-order token: ${token}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

function namedSection(content: string, heading: string) {
  const start = content.indexOf(`## ${heading}`);
  expect(start, `missing section: ${heading}`).toBeGreaterThan(-1);
  const end = content.indexOf("\n## ", start + heading.length + 3);
  return content.slice(start, end === -1 ? undefined : end);
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-workflow-"));
});

afterEach(() => {
  rmSync(tempDir, { force: true, recursive: true });
});

describe("job application workflow contract", () => {
  it("fails closed at the daily readiness gate before identity or discovery", () => {
    const daily = namedSection(workflow, "Daily Qualified Discovery Mode");
    expectInOrder(daily, [
      "status === `ready`", "saved local project checkout `projectRoot`",
      "successful read-only access", "jobtracker-database-identity.mjs verify"
    ]);
    expect(daily).toContain("needs_input");
    expect(daily).toContain("blocked");
    expect(daily).toContain("do not mutate the tracker or create materials");
  });

  it("uses a truthful daily assessment before the executable coordinator", () => {
    const daily = namedSection(workflow, "Daily Qualified Discovery Mode");
    expectInOrder(daily, [
      "faithfully", "no optimization for a target score", "prepare-qualified-job.mjs"
    ]);
    expect(daily).toContain("Only the evaluator/coordinator computes `overallScore`, `mandatoryMatch`, `seniorityMatch`, and `eligible`");
    expect(daily).toContain("every otherwise scoreable candidate");
    expect(daily).toContain("skip_ineligible");
    expect(daily).toContain("An unavailable localhost port 3000 does not authorize starting a second server or selecting another database.");
  });

  it("isolates daily candidate failures while retaining the outer lock finally", () => {
    const daily = namedSection(workflow, "Daily Qualified Discovery Mode");
    expect(daily).toContain("outer run-level `try`/`finally`");
    expect(daily).toContain("per-candidate failure boundary");
    expect(daily).toContain("continue independent candidates");
    expect(daily).toContain("time exhaustion stops before starting the next candidate");
    expect(daily).toContain("incomplete dossiers are never reported as ready");
  });

  it("requires an evaluator gate before supplied-link intake and five-output materials", () => {
    const suppliedLink = namedSection(workflow, "Supplied Public Link Sequence");
    expectInOrder(suppliedLink, [
      "truthful assessment", "evaluate-job-match.mjs", "eligible: true",
      "job-tracker-add-posting", "assessment and evaluator result", "all five outputs"
    ]);
    expect(suppliedLink).toContain("invalid or ineligible result stops before intake");
  });

  it("places the five-output contract in the resume skill itself", () => {
    const dossier = namedSection(resumeSkill, "Complete Dossier Contract");
    for (const required of [
      "Tailored Resume", "Fit Analysis", "Cover Letter", "Outreach Message", "Submission Guide",
      "--type resume", "--type fit_analysis", "--type cover_letter", "--type outreach_message", "--type other"
    ]) expect(dossier).toContain(required);
  });

  it("prohibits every authenticated or submission action in every skill", () => {
    for (const skill of [workflow, postingSkill, resumeSkill]) {
      for (const prohibited of ["sign in", "log in", "use credentials", "upload", "fill forms", "attest", "solve captchas", "send", "submit"]) {
        expect(skill.toLowerCase()).toContain(`never ${prohibited}`);
      }
    }
  });
  it("orders daily qualified discovery from readiness through lock release", () => {
    expectInOrder(workflow, [
      "check-application-readiness.mjs",
      "jobtracker-database-identity.mjs verify",
      "daily-job-prep-lock.mjs acquire",
      "public discovery",
      "prepare-qualified-job.mjs",
      "job-application-resume",
      "daily-job-prep-lock.mjs release"
    ]);

    for (const required of [
      "08:00 Etc/UTC", "executionEnvironment=local", "saved local project checkout",
      "database.path", "jobtracker_instance_id", "six-hour", "applicationsDirectory.path",
      "never start a second server", "employer career page", "overallScore >= 80",
      "mandatoryMatch >= 80", "seniorityMatch >= 75", "eligible: true", "skip_ineligible",
      "skip_inactive", "skip_complete", "repair_dossier", "prepare_dossier",
      "never pass `--reactivate`", "rejected or archived", "wishlist", "Needs Your Answer",
      "never submit"
    ]) expect(workflow).toContain(required);

    expect(workflow).toContain("intake and materials are forbidden until the executable coordinator returns an eligible `repair_dossier` or `prepare_dossier` decision");
    expect(workflow).toContain("finally");
    expect(workflow).toContain("stop on identity or lock failure");
  });

  it("defines every daily dossier artifact contract", () => {
    for (const [type, title] of [
      ["resume", "Tailored Resume"],
      ["fit_analysis", "Fit Analysis"],
      ["cover_letter", "Cover Letter"],
      ["outreach_message", "Outreach Message"],
      ["other", "Submission Guide"]
    ]) {
      expect(`${workflow}\n${resumeSkill}`).toContain(`--type ${type}`);
      expect(`${workflow}\n${resumeSkill}`).toContain(`--title \"${title}\"`);
    }
  });

  it("routes automated posting work through the guarded executable coordinator", () => {
    for (const required of [
      "automated discovery mode", "prepare-qualified-job.mjs", "expected-database-id", "lock-token",
      "transactional precondition", "never pass `--reactivate`", "skip rejected or archived",
      "preserve existing valid files", "wishlist"
    ]) expect(postingSkill).toContain(required);
  });

  it("requires guarded five-artifact materials without submission authority", () => {
    for (const required of [
      "overallScore", "mandatoryMatch", "seniorityMatch", "criterion-by-criterion evidence matrix",
      "cover_letter", "outreach_message", "Submission Guide", "--type other", "Needs Your Answer",
      "local PDF snapshot", "expected-status wishlist", "expected-updated-at", "lock-token",
      "commit-job-dossier.mjs", ".staging", "preserve every already-valid artifact",
      "user—not the automation—must review and submit"
    ]) expect(resumeSkill).toContain(required);

    expect(resumeSkill).toContain("Keep resumes company-neutral");
    expect(resumeSkill).toContain("## Areas Where I Am Well-Qualified");
    expect(resumeSkill).toContain("## Sources");
    for (const skill of [workflow, postingSkill, resumeSkill]) {
      expect(skill.toLowerCase()).not.toMatch(/authorize[^\n]*(sign in|upload|attest|submit)/);
    }
  });
  it("orders readiness before intake before materials", () => {
    const readiness = workflow.indexOf("check-application-readiness.mjs");
    const intake = workflow.indexOf("job-tracker-add-posting");
    const materials = workflow.indexOf("job-application-resume");

    expect(readiness).toBeGreaterThan(-1);
    expect(intake).toBeGreaterThan(readiness);
    expect(materials).toBeGreaterThan(intake);
  });

  it("propagates resolved database and applications paths", () => {
    expect(workflow).toContain("database.path");
    expect(workflow).toContain("applicationsDirectory.path");
    expect(workflow).toContain("--db");
    expect(workflow).toContain("--applications-dir");
  });

  it("protects the master and registers only an existing local snapshot", () => {
    expect(workflow).toContain("read-only master");
    expect(workflow).toContain("role-specific copy");
    expect(workflow).toContain("snapshot exists before registration");
    expect(workflow).toContain("do not claim tracker resume registration succeeded");
  });

  it("routes fresh repository sessions through the source coordinator", () => {
    const agents = readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
    const claude = readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8");

    expect(agents).toContain("skills/job-application-workflow/SKILL.md");
    expect(agents).toContain("$job-application-workflow");
    expect(claude).toContain(".claude/skills/job-application-workflow/SKILL.md");
    expect(claude).toContain("/job-application-workflow");
  });

  it("persists profile-only input for reuse by fresh tasks", () => {
    const agents = readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
    const claude = readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8");

    for (const instructions of [agents, claude]) {
      expect(instructions).toContain("configure, save, remember, or update");
      expect(instructions).toContain("resume or public professional-profile references");
    }
    expect(workflow).toContain("configure, save, remember, or update");
    expect(workflow).toContain("persist every supplied allowlisted field together");
    expect(workflow).toContain("Omit fields the user did not supply");
    expect(workflow).toContain("Rerun readiness after the combined update");
  });

  it("makes direct resume invocation establish the same readiness contract", () => {
    expect(resumeSkill).toContain("When no coordinating readiness result is supplied");
    expect(resumeSkill).toContain("run and parse `node scripts/check-application-readiness.mjs`");
    expect(resumeSkill).toContain("verified opportunity ID");
    expect(resumeSkill).toContain("absolute `database.path`");
    expect(resumeSkill).toContain("absolute `applicationsDirectory.path`");
  });

  it("makes direct posting invocation discover the configured database through readiness", () => {
    expect(postingSkill).toContain("When no coordinating readiness result is supplied");
    expect(postingSkill).toContain("run and parse `node scripts/check-application-readiness.mjs`");
    expect(postingSkill).toContain("absolute `database.path`");
    expect(postingSkill).toContain("database.parentExists");
    expect(postingSkill).toContain("database.parentWritable");
  });

  it("stops direct posting intake when configuration or database readiness is blocked", () => {
    expect(postingSkill).toContain("`configuration_unreadable`");
    expect(postingSkill).toContain("`database_parent_unavailable`");
    expect(postingSkill).toContain("`database_parent_unwritable`");
    expect(postingSkill).toContain("`database_parent_permission_denied`");
    expect(postingSkill).toContain("`database_parent_inspection_failed`");
    expect(postingSkill).toContain("Ignore only application-material issues");
  });

  it("keeps new-user setup Google-first in both root instruction files", () => {
    const agents = readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
    const claude = readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8");

    for (const instructions of [agents, claude]) {
      expect(instructions).toContain("private Google Docs URL first");
      expect(instructions).toContain("DOCX/PDF fallback");
      expect(instructions).toContain("optional public profile context");
    }
  });

  it("documents the repository-local default and existing-install migration", () => {
    const readme = readFileSync(path.join(projectRoot, "README.md"), "utf8");
    const setup = readFileSync(path.join(projectRoot, "docs", "agent-setup.md"), "utf8");

    for (const content of [readme, setup]) {
      for (const required of [
        "./applications",
        "relative to the repository",
        "npm run artifacts:backfill",
        "--applications-dir",
        "restart"
      ]) {
        expect(content.toLowerCase()).toContain(required.toLowerCase());
      }
    }
  });

  it("documents the Git-ignore prerequisite for custom relative applications folders", () => {
    const readme = readFileSync(path.join(projectRoot, "README.md"), "utf8");
    const setup = readFileSync(path.join(projectRoot, "docs", "agent-setup.md"), "utf8");

    for (const content of [readme, setup]) {
      expect(content.toLowerCase()).toContain("custom relative");
      expect(content.toLowerCase()).toContain("already be ignored by git");
      expect(content).toContain(".gitignore");
      expect(content.toLowerCase()).toContain("external absolute path");
    }
  });

  it("documents configured backfill and collision-safe folder moves", () => {
    const readme = readFileSync(path.join(projectRoot, "README.md"), "utf8");
    const setup = readFileSync(path.join(projectRoot, "docs", "agent-setup.md"), "utf8");

    for (const content of [readme, setup]) {
      expect(content).toContain("`npm run artifacts:backfill` loads `.env.local`");
      expect(content.toLowerCase()).toContain("destination company folders and files do not already exist");
      expect(content.toLowerCase()).toContain("abort and report");
      expect(content.toLowerCase()).toContain("do not merge, replace, or overwrite");
    }
  });

  it("keeps agents from reinterpreting the default as a root path", () => {
    const agents = readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
    const claude = readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8");

    for (const content of [agents, claude, workflow]) {
      expect(content).toContain("./applications");
      expect(content.toLowerCase()).toContain("do not ask");
      expect(content.toLowerCase()).toContain("remain relative");
      expect(content).toContain("/applications");
    }
  });

  it("uses the exact no-link ready sentence", () => {
    const agents = readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
    const claude = readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8");

    expect(workflow).toContain(readySentence);
    expect(agents).toContain(readySentence);
    expect(claude).toContain(readySentence);
  });

  it("invites another link only after successful completion", () => {
    expect(workflow).toContain(successfulCompletionInstruction);
    expect(workflow.split(nextLinkSentence).length - 1).toBe(1);
  });

  it("real tracker commands stay on the supplied custom database", () => {
    const customDb = path.join(tempDir, "custom", "jobs.sqlite");
    const defaultDb = path.join(tempDir, "data", "jobtracker.sqlite");
    const created = JSON.parse(execFileSync(process.execPath, [
      path.join(projectRoot, "scripts/upsert-job-posting.mjs"),
      "--db", customDb,
      "--company", "Fixture Co",
      "--role", "Fixture Role",
      "--url", "https://example.com/jobs/fixture"
    ], { cwd: tempDir, encoding: "utf8" }));
    const snapshot = path.join(tempDir, "external-applications", "Fixture Co", "fixture-role-resume.pdf");
    mkdirSync(path.dirname(snapshot), { recursive: true });
    writeFileSync(snapshot, "fixture snapshot");

    execFileSync(process.execPath, [
      path.join(projectRoot, "scripts/register-application-artifact.mjs"),
      "--db", customDb,
      "--opportunity-id", created.opportunity.id,
      "--type", "resume",
      "--title", "Resume",
      "--file", snapshot
    ]);

    expect(existsSync(customDb)).toBe(true);
    expect(existsSync(defaultDb)).toBe(false);
  });
});
