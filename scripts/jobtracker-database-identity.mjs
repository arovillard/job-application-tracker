#!/usr/bin/env node
import { initializeDatabaseIdentity, verifyDatabaseIdentity } from "./lib/jobtracker-database-identity.mjs";

function parseOptions(action, args) {
  const allowed = action === "initialize" ? new Set(["db"]) : action === "verify" ? new Set(["db", "expected-id"]) : null;
  if (!allowed) throw new Error("usage: initialize --db PATH | verify --db PATH --expected-id UUID");
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || !value || !allowed.has(flag.slice(2)) || Object.hasOwn(options, flag.slice(2))) throw new Error("invalid options");
    options[flag.slice(2)] = value;
  }
  if (!options.db || (action === "verify" && !options["expected-id"])) throw new Error("invalid options");
  return options;
}

try {
  const [action, ...args] = process.argv.slice(2);
  const options = parseOptions(action, args);
  const result = action === "initialize"
    ? initializeDatabaseIdentity(options.db)
    : verifyDatabaseIdentity(options.db, options["expected-id"]);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
