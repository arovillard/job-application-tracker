import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const APPLICATION_CONFIG_KEYS = Object.freeze({
  applicationsDirectory: "JOBTRACKER_APPLICATIONS_DIR",
  baseResumeUrl: "JOBTRACKER_BASE_RESUME_URL",
  baseResumePath: "JOBTRACKER_BASE_RESUME_PATH",
  profileUrl: "JOBTRACKER_LINKEDIN_URL"
});

const SETUP_CONFIG_KEYS = Object.freeze({
  ...APPLICATION_CONFIG_KEYS,
  databasePath: "JOBTRACKER_DB_PATH",
  providerNote: "JOBTRACKER_AI_PROVIDER"
});

const DEFAULT_APPLICATIONS_DIRECTORY = "./applications";

const REQUIRED_SKILLS = Object.freeze([
  "daily-job-discovery-setup",
  "job-application-resume",
  "job-application-workflow",
  "job-tracker-add-posting"
]);

const USER_ISSUES = new Set([
  "resume_missing",
  "resume_invalid",
  "applications_directory_unconfigured",
  "applications_directory_unavailable",
  "database_parent_unavailable"
]);

function unquoteDotenv(value) {
  const trimmed = value.trim();
  if (trimmed.length < 2 || !['"', "'"].includes(trimmed[0]) || trimmed.at(-1) !== trimmed[0]) {
    return trimmed;
  }
  const inner = trimmed.slice(1, -1);
  if (trimmed[0] === "'") return inner;
  return inner.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function parseDotenv(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) values[match[1]] = unquoteDotenv(match[2]);
  }
  return values;
}

function resolveConfigPath(projectRoot, value) {
  const selected = String(value ?? "").trim();
  if (!selected) return "";
  if (selected === "~") return os.homedir();
  if (selected.startsWith("~/")) return path.resolve(os.homedir(), selected.slice(2));
  return path.isAbsolute(selected) ? path.normalize(selected) : path.resolve(projectRoot, selected);
}

function isAmbiguousApplicationsDirectory(target) {
  const normalized = path.normalize(target);
  return path.dirname(normalized) === path.parse(normalized).root
    && path.basename(normalized).toLowerCase() === "applications";
}

export function resolveApplicationsDirectory(projectRoot, value = "") {
  const selected = String(value ?? "").trim() || DEFAULT_APPLICATIONS_DIRECTORY;
  const resolved = resolveConfigPath(path.resolve(projectRoot), selected);
  if (isAmbiguousApplicationsDirectory(resolved)) {
    throw new Error('applicationsDirectory cannot be "/applications". Use "./applications" for the repository folder or choose a different absolute path.');
  }
  return resolved;
}

function normalizeApplicationsDirectory(projectRoot, value) {
  const selected = String(value ?? "").trim() || DEFAULT_APPLICATIONS_DIRECTORY;
  const resolved = resolveApplicationsDirectory(projectRoot, selected);
  return resolved === path.join(path.resolve(projectRoot), "applications")
    ? DEFAULT_APPLICATIONS_DIRECTORY
    : path.isAbsolute(selected) ? path.normalize(selected) : selected;
}

function readConfigFile(projectRoot) {
  const filename = path.join(projectRoot, ".env.local");
  if (!existsSync(filename)) return { values: {}, error: null };
  try {
    accessSync(filename, constants.R_OK);
    return { values: parseDotenv(readFileSync(filename, "utf8")), error: null };
  } catch (error) {
    return { values: {}, error };
  }
}

function mergeKnownEnvironment(fileValues, processEnv) {
  const merged = { ...fileValues };
  for (const key of [...Object.values(SETUP_CONFIG_KEYS)]) {
    if (Object.prototype.hasOwnProperty.call(processEnv, key)) merged[key] = processEnv[key];
  }
  return merged;
}

export function readApplicationConfig(projectRoot, processEnv = process.env) {
  const absoluteRoot = path.resolve(projectRoot);
  const { values, error } = readConfigFile(absoluteRoot);
  if (error) throw new Error(`Unable to read ${path.join(absoluteRoot, ".env.local")}: ${error.message}`);
  const merged = mergeKnownEnvironment(values, processEnv ?? {});
  return {
    applicationsDirectory: resolveConfigPath(
      absoluteRoot,
      String(merged.JOBTRACKER_APPLICATIONS_DIR ?? "").trim() || DEFAULT_APPLICATIONS_DIRECTORY
    ),
    baseResumeUrl: String(merged.JOBTRACKER_BASE_RESUME_URL ?? "").trim(),
    baseResumePath: resolveConfigPath(absoluteRoot, merged.JOBTRACKER_BASE_RESUME_PATH ?? ""),
    profileUrl: String(merged.JOBTRACKER_LINKEDIN_URL ?? "").trim(),
    databasePath: resolveConfigPath(absoluteRoot, merged.JOBTRACKER_DB_PATH ?? "./data/jobtracker.sqlite")
  };
}

function googleDocumentIdentity(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null;
    const match = url.pathname.match(/^\/document\/d\/([^/]+)(?:\/.*)?$/);
    if (!match || !match[1]) return null;
    return `https://docs.google.com/document/d/${match[1]}`;
  } catch {
    return null;
  }
}

function localResumeKind(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".docx") return "docx";
  if (extension === ".pdf") return "pdf";
  if ([".md", ".markdown", ".txt"].includes(extension)) return "text";
  return null;
}

function canAccess(target, mode) {
  try {
    accessSync(target, mode);
    return true;
  } catch {
    return false;
  }
}

function inspectPath(target) {
  try {
    return { state: "ok", stats: statSync(target) };
  } catch (error) {
    if (error && ["ENOENT", "ENOTDIR"].includes(error.code)) return { state: "missing", stats: null };
    if (error && ["EACCES", "EPERM"].includes(error.code)) return { state: "permission_denied", stats: null };
    return { state: "error", stats: null };
  }
}

function canonicalPath(target) {
  const unresolved = [];
  let existing = path.resolve(target);
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return path.resolve(target);
    unresolved.unshift(path.basename(existing));
    existing = parent;
  }
  try {
    return path.join(realpathSync(existing), ...unresolved);
  } catch {
    return path.resolve(target);
  }
}

function isInside(root, target) {
  const relative = path.relative(canonicalPath(root), canonicalPath(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isGitIgnored(projectRoot, target, directory = false) {
  const canonicalRoot = canonicalPath(projectRoot);
  const canonicalTarget = canonicalPath(target);
  if (!isInside(canonicalRoot, canonicalTarget)) return true;
  const probe = directory ? path.join(canonicalTarget, "jobtracker-private-probe") : canonicalTarget;
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", probe], {
      cwd: canonicalRoot,
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

export function validateApplicationsDirectoryPrivacy(projectRoot, target) {
  const root = path.resolve(projectRoot);
  const resolved = resolveApplicationsDirectory(root, target);
  if (!isInside(root, resolved) || isGitIgnored(root, resolved, true)) return resolved;

  const relative = path.relative(canonicalPath(root), canonicalPath(resolved)).split(path.sep).join("/");
  if (!relative) {
    throw new Error(
      "The repository root cannot be used as the applications directory. "
      + "Use ./applications, another ignored repository subdirectory, or an external absolute path."
    );
  }
  const literalRelative = relative.replace(/[\\*?[\]]/g, "\\$&");
  const ignoreRule = `/${literalRelative.replace(/\/$/, "")}/`;
  throw new Error(
    `Repository-local applications directory "${resolved}" is not ignored by Git. `
    + `Add the exact rule "${ignoreRule}" to .gitignore or .git/info/exclude before setup, then retry, `
    + "or choose an external absolute path."
  );
}

function allSkillsExist(root) {
  return REQUIRED_SKILLS.every((name) => existsSync(path.join(root, "skills", name, "SKILL.md")));
}

function personalSkillsExist(home) {
  return REQUIRED_SKILLS.every((name) => existsSync(path.join(home, "skills", name, "SKILL.md")));
}

function directoryContentsMatch(source, installed) {
  try {
    const sourceEntries = readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const installedEntries = readdirSync(installed, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    if (sourceEntries.length !== installedEntries.length) return false;
    for (let index = 0; index < sourceEntries.length; index += 1) {
      const sourceEntry = sourceEntries[index];
      const installedEntry = installedEntries[index];
      if (sourceEntry.name !== installedEntry.name) return false;
      const sourcePath = path.join(source, sourceEntry.name);
      const installedPath = path.join(installed, installedEntry.name);
      if (sourceEntry.isDirectory() !== installedEntry.isDirectory()) return false;
      if (sourceEntry.isFile() !== installedEntry.isFile()) return false;
      if (sourceEntry.isDirectory()) {
        if (!directoryContentsMatch(sourcePath, installedPath)) return false;
      } else if (sourceEntry.isFile()) {
        if (!readFileSync(sourcePath).equals(readFileSync(installedPath))) return false;
      } else {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function personalSkillsStale(sourceRoot, home) {
  const installedRoot = path.join(home, "skills");
  return REQUIRED_SKILLS.some((name) => !directoryContentsMatch(
    path.join(sourceRoot, name),
    path.join(installedRoot, name)
  ));
}

function unique(values) {
  return [...new Set(values)];
}

export function evaluateApplicationReadiness({
  projectRoot,
  processEnv = process.env,
  codexHome,
  claudeHome
}) {
  const absoluteRoot = path.resolve(projectRoot);
  const blockingIssues = [];
  const warnings = [];
  let config;
  try {
    config = readApplicationConfig(absoluteRoot, processEnv);
  } catch {
    blockingIssues.push("configuration_unreadable");
    config = {
      applicationsDirectory: path.join(absoluteRoot, "applications"),
      baseResumeUrl: "",
      baseResumePath: "",
      profileUrl: "",
      databasePath: path.join(absoluteRoot, "data", "jobtracker.sqlite")
    };
  }

  let resume;
  const googleIdentity = config.baseResumeUrl ? googleDocumentIdentity(config.baseResumeUrl) : null;
  if (config.baseResumeUrl && config.baseResumePath) warnings.push("multiple_resume_sources");
  if (config.baseResumeUrl) {
    const valid = Boolean(googleIdentity);
    resume = {
      kind: valid ? "google_doc" : "none",
      configured: true,
      locallyValid: valid,
      requiresExternalAccessCheck: valid,
      location: valid ? googleIdentity : "invalid Google Docs URL",
      message: valid
        ? "Google Doc configured; confirm access through the connected host before use."
        : "Provide a Google Docs document URL in the form https://docs.google.com/document/d/<id>."
    };
    if (!valid) blockingIssues.push("resume_invalid");
  } else if (config.baseResumePath) {
    const kind = localResumeKind(config.baseResumePath);
    const inspection = inspectPath(config.baseResumePath);
    const file = inspection.state === "ok" && inspection.stats.isFile();
    const permissionBits = file ? inspection.stats.mode & 0o444 : 0;
    const readable = file && Boolean(permissionBits) && canAccess(config.baseResumePath, constants.R_OK);
    const valid = Boolean(kind && readable);
    resume = {
      kind: kind ?? "none",
      configured: true,
      locallyValid: valid,
      requiresExternalAccessCheck: false,
      location: config.baseResumePath,
      message: valid
        ? "Local master resume is available and must be treated as read-only."
        : "Choose an existing readable DOCX, PDF, Markdown, or text resume."
    };
    if (inspection.state === "permission_denied") blockingIssues.push("resume_permission_denied");
    else if (inspection.state === "error") blockingIssues.push("resume_inspection_failed");
    else if (kind && file && !readable) blockingIssues.push("resume_unreadable");
    else if (!valid) blockingIssues.push("resume_invalid");
    if (kind === "pdf") warnings.push("pdf_formatting_limited");
    if (isInside(absoluteRoot, config.baseResumePath) && !isGitIgnored(absoluteRoot, config.baseResumePath)) {
      blockingIssues.push("resume_path_not_ignored");
    }
  } else {
    resume = {
      kind: "none",
      configured: false,
      locallyValid: false,
      requiresExternalAccessCheck: false,
      location: "not configured",
      message: "Configure a Google Doc, DOCX, PDF, Markdown, or text resume."
    };
    blockingIssues.push("resume_missing");
  }

  const applicationsPath = config.applicationsDirectory;
  const applicationsConfigured = Boolean(applicationsPath);
  const applicationsInspection = applicationsConfigured ? inspectPath(applicationsPath) : { state: "missing", stats: null };
  const applicationsExists = applicationsInspection.state === "ok" && applicationsInspection.stats.isDirectory();
  const applicationsWritable = applicationsExists
    && Boolean(applicationsInspection.stats.mode & 0o222)
    && canAccess(applicationsPath, constants.W_OK);
  if (isAmbiguousApplicationsDirectory(applicationsPath)) blockingIssues.push("applications_directory_ambiguous");
  else if (!applicationsConfigured) blockingIssues.push("applications_directory_unconfigured");
  else if (applicationsInspection.state === "permission_denied") blockingIssues.push("applications_directory_permission_denied");
  else if (applicationsInspection.state === "error") blockingIssues.push("applications_directory_inspection_failed");
  else if (!applicationsExists) blockingIssues.push("applications_directory_unavailable");
  else if (!applicationsWritable) blockingIssues.push("applications_directory_unwritable");
  if (applicationsConfigured && !isAmbiguousApplicationsDirectory(applicationsPath)) {
    try {
      validateApplicationsDirectoryPrivacy(absoluteRoot, applicationsPath);
    } catch {
      blockingIssues.push("applications_directory_not_ignored");
    }
  }

  const databaseParent = path.dirname(config.databasePath);
  const databaseInspection = inspectPath(databaseParent);
  const databaseParentExists = databaseInspection.state === "ok" && databaseInspection.stats.isDirectory();
  const databaseParentWritable = databaseParentExists
    && Boolean(databaseInspection.stats.mode & 0o222)
    && canAccess(databaseParent, constants.W_OK);
  if (databaseInspection.state === "permission_denied") blockingIssues.push("database_parent_permission_denied");
  else if (databaseInspection.state === "error") blockingIssues.push("database_parent_inspection_failed");
  else if (!databaseParentExists) blockingIssues.push("database_parent_unavailable");
  else if (!databaseParentWritable) blockingIssues.push("database_parent_unwritable");

  const repositoryComplete = allSkillsExist(absoluteRoot);
  if (!repositoryComplete) blockingIssues.push("skills_repository_incomplete");
  const resolvedCodexHome = path.resolve(codexHome ?? processEnv.CODEX_HOME ?? path.join(os.homedir(), ".codex"));
  const resolvedClaudeHome = path.resolve(claudeHome ?? processEnv.CLAUDE_HOME ?? path.join(os.homedir(), ".claude"));
  const codexInstalled = personalSkillsExist(resolvedCodexHome);
  const claudeInstalled = personalSkillsExist(resolvedClaudeHome);
  if (!codexInstalled) warnings.push("codex_skills_not_installed");
  else if (personalSkillsStale(path.join(absoluteRoot, "skills"), resolvedCodexHome)) warnings.push("codex_skills_stale");
  if (!claudeInstalled) warnings.push("claude_skills_not_installed");
  else if (personalSkillsStale(path.join(absoluteRoot, ".claude", "skills"), resolvedClaudeHome)) warnings.push("claude_skills_stale");
  if (!config.profileUrl) warnings.push("profile_missing");

  const issues = unique(blockingIssues);
  const hasSystemBlocker = issues.some((issue) => !USER_ISSUES.has(issue));
  return {
    schemaVersion: 1,
    status: hasSystemBlocker ? "blocked" : issues.length ? "needs_input" : "ready",
    projectRoot: absoluteRoot,
    resume,
    profile: {
      configured: Boolean(config.profileUrl),
      blocking: false,
      message: config.profileUrl
        ? "Public profile configured."
        : "Public profile is recommended but optional."
    },
    applicationsDirectory: {
      path: applicationsPath,
      exists: applicationsExists,
      writable: applicationsWritable
    },
    database: {
      path: config.databasePath,
      parentExists: databaseParentExists,
      parentWritable: databaseParentWritable
    },
    skills: { repositoryComplete, codexInstalled, claudeInstalled },
    blockingIssues: issues,
    warnings: unique(warnings)
  };
}

function quoteDotenv(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function validateInput(input, allowedKeys) {
  if (!input || Array.isArray(input) || typeof input !== "object") throw new Error("Configuration input must be a JSON object.");
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(allowedKeys, key)) {
      throw new Error(`Unsupported configuration key: ${key}`);
    }
    if (typeof input[key] !== "string") throw new Error(`${key} must be a string.`);
  }
  if (input.baseResumeUrl && input.baseResumePath) throw new Error("Configure only one resume source.");
  if (input.baseResumeUrl && !googleDocumentIdentity(input.baseResumeUrl)) {
    throw new Error("baseResumeUrl must be a Google Docs document URL.");
  }
  if (input.baseResumePath && !localResumeKind(input.baseResumePath)) {
    throw new Error("baseResumePath must identify a DOCX, PDF, Markdown, or text file.");
  }
  if (input.profileUrl) {
    try {
      const url = new URL(input.profileUrl);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      throw new Error("profileUrl must be an HTTP or HTTPS URL.");
    }
  }
}

function replaceDotenvValues(contents, updates) {
  const remaining = new Map(Object.entries(updates));
  const lines = contents ? contents.split(/\r?\n/) : [];
  const result = [];
  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match && Object.prototype.hasOwnProperty.call(updates, match[1])) {
      if (remaining.has(match[1])) {
        result.push(`${match[1]}=${quoteDotenv(remaining.get(match[1]))}`);
        remaining.delete(match[1]);
      }
    } else {
      result.push(line);
    }
  }
  while (result.length && result.at(-1) === "") result.pop();
  for (const [key, value] of remaining) result.push(`${key}=${quoteDotenv(value)}`);
  return `${result.join("\n")}\n`;
}

function atomicWriteEnv(filename, contents, operations = {}) {
  const rename = operations.rename ?? renameSync;
  const remove = operations.unlink ?? unlinkSync;
  const temporary = path.join(path.dirname(filename), `.env.local.tmp-${process.pid}-${randomUUID()}`);
  const mode = existsSync(filename) ? lstatSync(filename).mode & 0o600 : 0o600;
  try {
    writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    chmodSync(temporary, mode);
    rename(temporary, filename);
  } catch (error) {
    try {
      if (existsSync(temporary)) remove(temporary);
    } catch {
      // Preserve the original write error; cleanup is best effort.
    }
    throw error;
  }
}

function configSummary(projectRoot, values) {
  const urlIdentity = values.baseResumeUrl ? googleDocumentIdentity(values.baseResumeUrl) : null;
  const resumePath = values.baseResumePath ? resolveConfigPath(projectRoot, values.baseResumePath) : "";
  const kind = urlIdentity ? "google_doc" : resumePath ? (localResumeKind(resumePath) ?? "none") : "none";
  return {
    applicationsDirectory: values.applicationsDirectory
      ? { configured: true, path: resolveConfigPath(projectRoot, values.applicationsDirectory) }
      : { configured: false },
    resume: {
      kind,
      configured: kind !== "none",
      ...(urlIdentity ? { location: urlIdentity } : resumePath ? { location: resumePath } : {})
    },
    profile: { configured: Boolean(values.profileUrl) }
  };
}

function updateConfig(projectRoot, input, allowedKeys, operations) {
  const root = path.resolve(projectRoot);
  validateInput(input, allowedKeys);
  const envPath = path.join(root, ".env.local");
  const read = operations?.readFile ?? readFileSync;
  const original = existsSync(envPath) ? read(envPath, "utf8") : "";
  const parsed = parseDotenv(original);
  const normalized = { ...input };
  if (Object.prototype.hasOwnProperty.call(input, "applicationsDirectory")) {
    normalized.applicationsDirectory = normalizeApplicationsDirectory(root, input.applicationsDirectory);
  }
  if (input.baseResumeUrl) normalized.baseResumePath = "";
  if (input.baseResumePath) normalized.baseResumeUrl = "";
  if (input.baseResumeUrl === "" && input.baseResumePath === "") {
    normalized.baseResumeUrl = "";
    normalized.baseResumePath = "";
  }
  const updates = {};
  for (const [key, value] of Object.entries(normalized)) updates[allowedKeys[key]] = value;
  atomicWriteEnv(envPath, replaceDotenvValues(original, updates), operations);
  const combined = { ...parsed };
  for (const [key, value] of Object.entries(normalized)) combined[allowedKeys[key]] = value;
  return configSummary(root, {
    applicationsDirectory: combined.JOBTRACKER_APPLICATIONS_DIR ?? "",
    baseResumeUrl: combined.JOBTRACKER_BASE_RESUME_URL ?? "",
    baseResumePath: combined.JOBTRACKER_BASE_RESUME_PATH ?? "",
    profileUrl: combined.JOBTRACKER_LINKEDIN_URL ?? ""
  });
}

export function updateApplicationConfig(projectRoot, input, operations) {
  return updateConfig(projectRoot, input, APPLICATION_CONFIG_KEYS, operations);
}

export function updateSetupConfig(projectRoot, input, operations) {
  return updateConfig(projectRoot, input, SETUP_CONFIG_KEYS, operations);
}
