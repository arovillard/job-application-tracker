import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("one-command startup contract", () => {
  it("maps npm run dev to the local supervisor and retains advanced commands", () => {
    const scripts = JSON.parse(read("package.json")).scripts;
    expect(scripts.dev).toBe("node scripts/run-local.mjs");
    expect(scripts["dev:web"]).toBe("next dev");
    expect(scripts["agent:worker"]).toBe("tsx scripts/agent-worker.ts");
  });

  it.each(["README.md", "AGENTS.md", "docs/agent-setup.md", "docs/agent-workflow.md"])(
    "%s names npm run dev as the normal one-command startup",
    (file) => {
      const text = read(file);
      expect(text).toContain("npm run dev");
      expect(text).toMatch(/web.+worker|worker.+web/is);
    }
  );

  it("keeps two-process commands only in the advanced workflow section", () => {
    const workflow = read("docs/agent-workflow.md");
    const advanced = workflow.indexOf("## Advanced debugging");
    expect(advanced).toBeGreaterThan(0);
    expect(workflow.indexOf("npm run dev:web")).toBeGreaterThan(advanced);
    expect(workflow.indexOf("npm run agent:worker")).toBeGreaterThan(advanced);
  });
});
