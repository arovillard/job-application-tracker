import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const CONTENT_RULES = [
  { id: "macos_home_path", pattern: /\/Users\/[^/\s"'`<>]+/g },
  { id: "linux_home_path", pattern: /\/home\/[^/\s"'`<>]+/g },
  { id: "windows_home_path", pattern: /[A-Za-z]:\\Users\\[^\\\s"'`<>]+/gi },
  { id: "local_orchestration_path", pattern: /\.codex[/\\]orchestration(?:[/\\]|$)/gi },
  { id: "local_worktree_path", pattern: /\.worktrees(?:[/\\]|$)/gi },
  { id: "desktop_path", pattern: /(?:^|[/\\])Desktop(?:[/\\]|$)/gi }
];

function normalizedPath(filename) {
  return filename.split(path.sep).join("/").replace(/^\.\//, "");
}

function privatePathRule(filename) {
  const value = normalizedPath(filename);
  if (/^\.env(?:\.|$)/.test(value) && value !== ".env.example") return "tracked_environment_file";
  if (/^data\/[^/]+\.sqlite(?:-.+)?$/i.test(value)) return "tracked_sqlite_state";
  if (value === "data/job-discovery.json") return "tracked_discovery_profile";
  if (value === "data/privacy-denylist.txt") return "tracked_privacy_denylist";
  if (value.startsWith("applications/") && value !== "applications/.gitkeep") return "tracked_application_material";
  return null;
}

function lineNumber(contents, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (contents.charCodeAt(cursor) === 10) line += 1;
  return line;
}

export function scanContent(filename, contents, options = {}) {
  if (typeof contents !== "string" || contents.includes("\0")) return [];
  const findings = [];
  for (const rule of CONTENT_RULES) {
    if (rule.id === "local_worktree_path" && [".gitignore", "eslint.config.mjs"].includes(normalizedPath(filename))) {
      continue;
    }
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(contents))) {
      findings.push({
        path: normalizedPath(filename),
        line: lineNumber(contents, match.index),
        rule: rule.id,
        match: match[0]
      });
      if (match[0].length === 0) rule.pattern.lastIndex += 1;
    }
  }
  for (const term of options.privateTerms ?? []) {
    if (typeof term !== "string" || !term.trim()) continue;
    const needle = term.trim().toLocaleLowerCase("en");
    const haystack = contents.toLocaleLowerCase("en");
    let cursor = 0;
    while ((cursor = haystack.indexOf(needle, cursor)) !== -1) {
      findings.push({
        path: normalizedPath(filename),
        line: lineNumber(contents, cursor),
        rule: "private_denylist_term",
        match: contents.slice(cursor, cursor + needle.length)
      });
      cursor += needle.length;
    }
  }
  return findings;
}

function privateTerms(root, supplied) {
  if (supplied) return supplied;
  try {
    return readFileSync(path.join(root, "data", "privacy-denylist.txt"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
}

function trackedFiles(root) {
  const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8"
  });
  return output.split("\0").filter(Boolean);
}

function scanCurrentTree(root, terms) {
  const findings = [];
  for (const filename of trackedFiles(root)) {
    const pathRule = privatePathRule(filename);
    if (pathRule) findings.push({ path: normalizedPath(filename), line: 0, rule: pathRule, match: filename });
    findings.push(...scanContent(filename, normalizedPath(filename), { privateTerms: terms }));
    let contents;
    try {
      contents = readFileSync(path.join(root, filename));
    } catch {
      continue;
    }
    if (contents.includes(0)) continue;
    findings.push(...scanContent(filename, contents.toString("utf8"), { privateTerms: terms }));
  }
  return findings;
}

function scanHistory(root, terms) {
  const commits = execFileSync("git", ["rev-list", "--all"], { cwd: root, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  const seenContent = new Set();
  const seenPaths = new Set();
  const findings = [];
  for (const commit of commits) {
    const message = execFileSync("git", ["show", "-s", "--format=%B", commit], {
      cwd: root,
      encoding: "utf8"
    });
    for (const finding of scanContent("<commit-message>", message, { privateTerms: terms })) {
      findings.push({ ...finding, ref: commit });
    }
    const tree = execFileSync("git", ["ls-tree", "-r", "-z", commit], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    });
    for (const record of tree.split("\0").filter(Boolean)) {
      const match = record.match(/^\d+\s+blob\s+([0-9a-f]+)\t(.+)$/);
      if (!match) continue;
      const [, objectId, filename] = match;
      const pathRule = privatePathRule(filename);
      const pathKey = `${objectId}:${filename}:${pathRule}`;
      if (pathRule && !seenPaths.has(pathKey)) {
        seenPaths.add(pathKey);
        findings.push({ path: normalizedPath(filename), line: 0, rule: pathRule, match: filename, ref: commit });
      }
      if (!seenPaths.has(`${objectId}:${filename}:content`)) {
        seenPaths.add(`${objectId}:${filename}:content`);
        for (const finding of scanContent(filename, normalizedPath(filename), { privateTerms: terms })) {
          findings.push({ ...finding, ref: commit });
        }
      }
      if (seenContent.has(objectId)) continue;
      seenContent.add(objectId);
      let contents;
      try {
        contents = execFileSync("git", ["cat-file", "-p", objectId], {
          cwd: root,
          encoding: null,
          maxBuffer: 32 * 1024 * 1024
        });
      } catch {
        continue;
      }
      if (contents.includes(0)) continue;
      for (const finding of scanContent(filename, contents.toString("utf8"), { privateTerms: terms })) {
        findings.push({ ...finding, ref: commit });
      }
    }
  }
  return findings;
}

export function scanRepositoryPrivacy(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const terms = privateTerms(root, options.privateTerms);
  const findings = options.history ? scanHistory(root, terms) : scanCurrentTree(root, terms);
  return { schemaVersion: 1, ok: findings.length === 0, mode: options.history ? "history" : "current", findings };
}
