import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "..");

describe("repository build hygiene", () => {
  it("keeps generated Next.js declarations ignored and untracked", () => {
    const ignore = readFileSync(path.join(projectRoot, ".gitignore"), "utf8");
    expect(ignore.split(/\r?\n/)).toContain("next-env.d.ts");
    expect(() => execFileSync("git", ["ls-files", "--error-unmatch", "next-env.d.ts"], {
      cwd: projectRoot,
      stdio: "ignore"
    })).toThrow();
  });

  it("generates Next.js types before standalone TypeScript checking", () => {
    const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    expect(packageJson.scripts.typecheck).toBe("next typegen && tsc --noEmit");
  });
});
