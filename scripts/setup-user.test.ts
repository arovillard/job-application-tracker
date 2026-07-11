import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// @ts-expect-error The setup entry point is intentionally plain ESM and exercised at runtime.
import { assertSupportedNodeVersion } from "./setup-user.mjs";

describe("setup Node.js floor", () => {
  it.each(["20.18.0", "19.99.99", "invalid"])("rejects unsupported version %s with actionable guidance", (version) => {
    expect(() => assertSupportedNodeVersion(version)).toThrow("Node.js 20.18.1 or newer");
  });

  it.each(["20.18.1", "20.19.0", "21.0.0", "24.1.0"])("accepts supported version %s", (version) => {
    expect(() => assertSupportedNodeVersion(version)).not.toThrow();
  });

  it("declares the same Node floor in package metadata, lockfile, and setup documentation", () => {
    const root = process.cwd();
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
    const setup = readFileSync(resolve(root, "docs/agent-setup.md"), "utf8");
    expect(packageJson.engines.node).toBe(">=20.18.1");
    expect(lock.packages[""].engines.node).toBe(">=20.18.1");
    expect(setup).toContain("Node.js 20.18.1 or newer");
  });
});
