import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  sanitizeProviderEvent,
  validatePublicJobUrl,
  verifyArtifactPath
} from "./security";

describe("public job URL validation", () => {
  it.each([
    "file:///etc/passwd",
    "ftp://example.com/job",
    "https://user:password@example.com/job",
    "https:///job",
    "https://localhost/job",
    "https://LOCALHOST./job",
    "https://jobs.localhost/job"
  ])("rejects an unsafe URL form: %s", async (input) => {
    await expect(validatePublicJobUrl(input)).rejects.toThrow("Job URL must use a public host.");
  });

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.2",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.2",
    "203.0.113.3",
    "224.0.0.1",
    "240.0.0.1",
    "::",
    "::1",
    "64:ff9b::1",
    "64:ff9b:1::1",
    "100::1",
    "fc00::1",
    "fd12::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "2001:db8::1",
    "3fff::1",
    "5f00::1"
  ])("rejects forbidden IP literal %s", async (address) => {
    const host = address.includes(":") ? `[${address}]` : address;
    await expect(validatePublicJobUrl(`https://${host}/job`)).rejects.toThrow(
      "Job URL must use a public host."
    );
  });

  it("resolves both A and AAAA records and returns a normalized public URL", async () => {
    const resolver = {
      resolve4: vi.fn(async () => ["93.184.216.34"]),
      resolve6: vi.fn(async () => ["2606:2800:220:1:248:1893:25c8:1946"])
    };

    await expect(
      validatePublicJobUrl("HTTPS://Jobs.Example.COM:443/a/../role?q=1#apply", resolver)
    ).resolves.toBe("https://jobs.example.com/role?q=1#apply");
    expect(resolver.resolve4).toHaveBeenCalledWith("jobs.example.com");
    expect(resolver.resolve6).toHaveBeenCalledWith("jobs.example.com");
  });

  it.each([
    [["93.184.216.34", "10.0.0.1"], ["2606:2800:220:1:248:1893:25c8:1946"]],
    [["93.184.216.34"], ["2606:2800:220:1:248:1893:25c8:1946", "fd00::1"]]
  ])("fails closed when any A or AAAA answer is forbidden", async (ipv4, ipv6) => {
    const resolver = {
      resolve4: vi.fn(async () => ipv4),
      resolve6: vi.fn(async () => ipv6)
    };

    await expect(validatePublicJobUrl("https://jobs.example.com/role", resolver)).rejects.toThrow(
      "Job URL must use a public host."
    );
  });

  it("uses a stable safe error for DNS failures", async () => {
    const resolver = {
      resolve4: vi.fn(async () => {
        throw new Error("resolver leaked internal server 10.0.0.2");
      }),
      resolve6: vi.fn(async () => ["2606:2800:220:1:248:1893:25c8:1946"])
    };

    await expect(validatePublicJobUrl("https://jobs.example.com/role", resolver)).rejects.toThrow(
      "Job URL hostname could not be resolved safely."
    );
    await expect(validatePublicJobUrl("https://jobs.example.com/role", resolver)).rejects.not.toThrow(
      "10.0.0.2"
    );
  });
});

let tempDir: string;
let applicationsRoot: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "jobtracker-artifacts-"));
  applicationsRoot = path.join(tempDir, "applications");
  mkdirSync(applicationsRoot);
});

afterEach(() => {
  rmSync(tempDir, { force: true, recursive: true });
});

describe("artifact path containment", () => {
  it("returns the canonical path of an existing regular file inside the real root", async () => {
    const artifact = path.join(applicationsRoot, "Acme", "resume.pdf");
    mkdirSync(path.dirname(artifact));
    writeFileSync(artifact, "resume");

    await expect(verifyArtifactPath(applicationsRoot, "Acme/resume.pdf")).resolves.toBe(
      realpathSync(artifact)
    );
  });

  it("rejects traversal, prefix collisions, missing paths, and directories", async () => {
    const siblingRoot = path.join(tempDir, "applications-private");
    mkdirSync(siblingRoot);
    const siblingFile = path.join(siblingRoot, "secret.txt");
    writeFileSync(siblingFile, "secret");

    await expect(verifyArtifactPath(applicationsRoot, "../applications-private/secret.txt")).rejects.toThrow(
      "Artifact path is not a regular file inside the applications root."
    );
    await expect(verifyArtifactPath(applicationsRoot, siblingFile)).rejects.toThrow(
      "Artifact path is not a regular file inside the applications root."
    );
    await expect(verifyArtifactPath(applicationsRoot, "missing.pdf")).rejects.toThrow(
      "Artifact path is not a regular file inside the applications root."
    );
    await expect(verifyArtifactPath(applicationsRoot, ".")).rejects.toThrow(
      "Artifact path is not a regular file inside the applications root."
    );
  });

  it("rejects a symlink that escapes the applications root", async () => {
    const outside = path.join(tempDir, "outside.pdf");
    const link = path.join(applicationsRoot, "resume.pdf");
    writeFileSync(outside, "secret");
    symlinkSync(outside, link);

    await expect(verifyArtifactPath(applicationsRoot, link)).rejects.toThrow(
      "Artifact path is not a regular file inside the applications root."
    );
  });
});

describe("provider event sanitization", () => {
  it("retains only allowlisted progress, scalar metadata, and numeric usage", () => {
    const sanitized = sanitizeProviderEvent({
      kind: "progress",
      message: `Writing resume; token=super-secret-value ${"x".repeat(2_000)}`,
      metadata: {
        phase: "materials",
        percent: 50,
        ready: true,
        nested: { private: true },
        env: "OPENAI_API_KEY=secret",
        toolInput: "cat ~/.ssh/id_rsa"
      },
      usage: {
        input_tokens: 120,
        output_tokens: 45,
        total_tokens: 165,
        negative: -1,
        infinite: Number.POSITIVE_INFINITY,
        raw_prompt: 999
      },
      reasoning: "private chain of thought",
      tool_input: { command: "cat ~/.ssh/id_rsa" },
      arguments: ["--danger"],
      env: { OPENAI_API_KEY: "secret" },
      stderr: "raw provider failure",
      unknown: "drop me"
    });

    expect(sanitized).toEqual({
      kind: "progress",
      message: expect.any(String),
      metadata: { phase: "materials", percent: 50 },
      usage: { input_tokens: 120, output_tokens: 45, total_tokens: 165 }
    });
    expect(sanitized.message).toContain("[REDACTED]");
    expect(sanitized.message).not.toContain("super-secret-value");
    expect(sanitized.message.length).toBeLessThanOrEqual(1_000);
    expect(JSON.stringify(sanitized)).not.toMatch(
      /chain of thought|id_rsa|OPENAI_API_KEY|raw provider failure|drop me/
    );
  });

  it("coerces unknown kinds and non-string messages to safe progress", () => {
    expect(sanitizeProviderEvent({ kind: "tool", message: { secret: true } })).toEqual({
      kind: "progress",
      message: "Provider progress update.",
      metadata: null,
      usage: null
    });
  });
});
