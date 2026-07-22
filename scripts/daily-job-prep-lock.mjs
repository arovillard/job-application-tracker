#!/usr/bin/env node
import { acquireDailyJobPrepLock, releaseDailyJobPrepLock, verifyDailyJobPrepLock } from "./lib/daily-job-prep-lock.mjs";

function parseOptions(action, args) {
  const allowed = action === "acquire" ? new Set(["db"]) : ["verify", "release"].includes(action) ? new Set(["db", "token"]) : null;
  if (!allowed) throw new Error("usage: acquire|verify|release --db PATH [--token TOKEN]");
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || !value || !allowed.has(flag.slice(2)) || Object.hasOwn(options, flag.slice(2))) throw new Error("invalid options");
    options[flag.slice(2)] = value;
  }
  if (!options.db || (action !== "acquire" && !options.token)) throw new Error("invalid options");
  return options;
}

try {
  const [action, ...args] = process.argv.slice(2);
  const options = parseOptions(action, args);
  const result = action === "acquire"
    ? acquireDailyJobPrepLock(options.db)
    : action === "verify"
      ? verifyDailyJobPrepLock(options.db, options.token)
      : releaseDailyJobPrepLock(options.db, options.token);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
