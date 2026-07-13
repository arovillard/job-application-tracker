#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

import { resolveApplicationsDirectory, updateSetupConfig } from "./lib/application-readiness.mjs";
import { installAllSkills } from "./lib/install-skills.mjs";

const modulePath = fileURLToPath(import.meta.url);
const defaultProjectRoot = path.resolve(path.dirname(modulePath), "..");

const RESUME_RECOMMENDATION = "Use a Google Doc for the best results. The agent can create a tailored copy while preserving your original resume and formatting. A Word document also works. PDFs are supported, but matching their formatting consistently can be difficult.";

function expandHome(value) {
  if (!value.startsWith("~")) {
    return value;
  }

  if (!process.env.HOME) {
    return value;
  }

  if (value === "~") {
    return process.env.HOME;
  }

  if (value.startsWith("~/")) {
    return path.join(process.env.HOME, value.slice(2));
  }

  return value;
}

function resolveUserPath(value, fallback, projectRoot) {
  const selected = String(value ?? "").trim() || fallback;
  if (!selected) return "";
  const expanded = expandHome(selected);
  return path.isAbsolute(expanded) ? expanded : path.resolve(projectRoot, expanded);
}

async function ask(question, fallback, rl, nonInteractive) {
  if (nonInteractive) {
    return fallback;
  }

  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = await rl.question(`${question}${suffix}: `);
  return answer.trim() || fallback;
}

function setupDefaults(projectRoot) {
  return {
    dbPath: path.join(projectRoot, "data", "jobtracker.sqlite"),
    applicationsDir: "./applications",
    googleDocUrl: "",
    localPath: "",
    linkedInUrl: "",
    aiProvider: "",
    installSkills: "Y"
  };
}

export function buildResumeConfig({ googleDocUrl = "", localPath = "" }) {
  const preferredUrl = String(googleDocUrl).trim();
  return {
    baseResumeUrl: preferredUrl,
    baseResumePath: preferredUrl ? "" : String(localPath).trim()
  };
}

export async function runSetup({ projectRoot, answers, installSkills }) {
  const root = path.resolve(projectRoot);
  const dbPath = resolveUserPath(answers.dbPath, "", root);
  const applicationsInput = String(answers.applicationsDir ?? "").trim() || "./applications";
  const applicationsDir = resolveApplicationsDirectory(root, applicationsInput);
  const resume = buildResumeConfig({
    googleDocUrl: answers.googleDocUrl,
    localPath: resolveUserPath(answers.localPath, "", root)
  });

  mkdirSync(path.dirname(dbPath), { recursive: true });
  mkdirSync(applicationsDir, { recursive: true });

  const summary = updateSetupConfig(root, {
    databasePath: dbPath,
    applicationsDirectory: applicationsInput,
    ...resume,
    profileUrl: String(answers.linkedInUrl ?? "").trim(),
    providerNote: String(answers.aiProvider ?? "").trim()
  });

  console.log("Wrote .env.local");
  console.log(`Database path: ${dbPath}`);
  console.log(`Application materials directory: ${applicationsDir}`);

  if (installSkills) {
    const result = installAllSkills(root);
    for (const [provider, installed] of Object.entries(result)) {
      console.log(`Installed ${installed.skillNames.length} ${provider} skills to ${installed.targetRoot}:`);
      for (const skillName of installed.skillNames) {
        console.log(`- ${skillName}`);
      }
    }
  }

  return summary;
}

async function main() {
  const projectRoot = defaultProjectRoot;
  const nonInteractive = process.argv.includes("--yes");
  const defaults = setupDefaults(projectRoot);
  const rl = nonInteractive ? null : createInterface({ input, output });

  try {
    const dbPath = await ask("SQLite database path", defaults.dbPath, rl, nonInteractive);
    const applicationsDir = await ask(
      "Application materials directory (relative paths use the project folder)",
      defaults.applicationsDir,
      rl,
      nonInteractive
    );
    console.log(RESUME_RECOMMENDATION);
    const googleDocUrl = await ask(
      "Base resume Google Doc URL (optional)",
      defaults.googleDocUrl,
      rl,
      nonInteractive
    );
    const localPath = googleDocUrl ? "" : await ask(
      "Base resume DOCX/PDF path (optional)",
      defaults.localPath,
      rl,
      nonInteractive
    );
    const linkedInUrl = await ask(
      "LinkedIn/profile URL (optional)",
      defaults.linkedInUrl,
      rl,
      nonInteractive
    );
    const aiProvider = await ask(
      "AI service note, credentials configured outside this repo (optional)",
      defaults.aiProvider,
      rl,
      nonInteractive
    );
    const installAnswer = await ask(
      "Install bundled Codex and Claude skills now? Y/n",
      defaults.installSkills,
      rl,
      nonInteractive
    );

    await runSetup({
      projectRoot,
      answers: { dbPath, applicationsDir, googleDocUrl, localPath, linkedInUrl, aiProvider },
      installSkills: !/^n/i.test(installAnswer)
    });
  } finally {
    rl?.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  await main();
}
