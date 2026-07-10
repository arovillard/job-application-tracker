import { promises as dns } from "node:dns";
import { realpath, stat } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

import type {
  AgentEventMetadataValue,
  AgentRunEventKind,
  AgentUsage
} from "./types";

const PUBLIC_HOST_ERROR = "Job URL must use a public host.";
const DNS_ERROR = "Job URL hostname could not be resolved safely.";
const ARTIFACT_ERROR = "Artifact path is not a regular file inside the applications root.";
const MAX_EVENT_MESSAGE_LENGTH = 1_000;
const MAX_METADATA_STRING_LENGTH = 256;

const EVENT_KINDS = new Set<AgentRunEventKind>([
  "status",
  "progress",
  "warning",
  "usage",
  "error"
]);
const METADATA_KEYS = new Set([
  "phase",
  "step",
  "status",
  "provider",
  "model",
  "operation",
  "item",
  "percent"
]);
const USAGE_KEYS = new Set([
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "cached_input_tokens",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cachedInputTokens"
]);

export type PublicDnsResolver = {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
};

export type SanitizedProviderEvent = {
  kind: AgentRunEventKind;
  message: string;
  metadata: Record<string, AgentEventMetadataValue> | null;
  usage: AgentUsage | null;
};

export async function validatePublicJobUrl(
  input: string,
  resolver: PublicDnsResolver = dns
): Promise<string> {
  let url: URL;
  try {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\/\//.test(input)) {
      throw new Error("missing host");
    }
    url = new URL(input);
  } catch {
    throw new Error(PUBLIC_HOST_ERROR);
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hostname === ""
  ) {
    throw new Error(PUBLIC_HOST_ERROR);
  }

  const hostname = stripIpv6Brackets(url.hostname).toLowerCase();
  const hostnameWithoutTrailingDot = hostname.replace(/\.+$/, "");
  if (
    hostnameWithoutTrailingDot === "localhost" ||
    hostnameWithoutTrailingDot.endsWith(".localhost")
  ) {
    throw new Error(PUBLIC_HOST_ERROR);
  }

  if (isIP(hostname)) {
    if (isForbiddenAddress(hostname)) throw new Error(PUBLIC_HOST_ERROR);
    return url.toString();
  }

  const [ipv4Result, ipv6Result] = await Promise.allSettled([
    resolver.resolve4(hostnameWithoutTrailingDot),
    resolver.resolve6(hostnameWithoutTrailingDot)
  ]);

  for (const result of [ipv4Result, ipv6Result]) {
    if (result.status === "rejected" && !isNoDataDnsError(result.reason)) {
      throw new Error(DNS_ERROR);
    }
  }

  const addresses = [
    ...(ipv4Result.status === "fulfilled" ? ipv4Result.value : []),
    ...(ipv6Result.status === "fulfilled" ? ipv6Result.value : [])
  ];
  if (addresses.length === 0) throw new Error(DNS_ERROR);
  if (addresses.some(isForbiddenAddress)) throw new Error(PUBLIC_HOST_ERROR);

  return url.toString();
}

export async function verifyArtifactPath(root: string, candidate: string): Promise<string> {
  try {
    const realRoot = await realpath(root);
    const rootStats = await stat(realRoot);
    if (!rootStats.isDirectory()) throw new Error(ARTIFACT_ERROR);

    const candidatePath = path.isAbsolute(candidate) ? candidate : path.resolve(root, candidate);
    const realCandidate = await realpath(candidatePath);
    const relative = path.relative(realRoot, realCandidate);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(ARTIFACT_ERROR);
    }

    const candidateStats = await stat(realCandidate);
    if (!candidateStats.isFile()) throw new Error(ARTIFACT_ERROR);
    return realCandidate;
  } catch {
    throw new Error(ARTIFACT_ERROR);
  }
}

export function sanitizeProviderEvent(input: unknown): SanitizedProviderEvent {
  const event = isRecord(input) ? input : {};
  const kind = isEventKind(event.kind) ? event.kind : "progress";
  const message =
    typeof event.message === "string"
      ? sanitizeText(event.message, MAX_EVENT_MESSAGE_LENGTH) || "Provider progress update."
      : "Provider progress update.";

  return {
    kind,
    message,
    metadata: sanitizeMetadata(event.metadata),
    usage: sanitizeUsage(event.usage)
  };
}

function sanitizeMetadata(value: unknown): Record<string, AgentEventMetadataValue> | null {
  if (!isRecord(value)) return null;
  const metadata: Record<string, AgentEventMetadataValue> = {};

  for (const [key, item] of Object.entries(value)) {
    if (!METADATA_KEYS.has(key)) continue;
    if (typeof item === "string") {
      metadata[key] = sanitizeText(item, MAX_METADATA_STRING_LENGTH);
    } else if (typeof item === "number" && Number.isFinite(item)) {
      metadata[key] = item;
    } else if (typeof item === "boolean" || item === null) {
      metadata[key] = item;
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
}

function sanitizeUsage(value: unknown): AgentUsage | null {
  if (!isRecord(value)) return null;
  const usage: AgentUsage = {};

  for (const [key, item] of Object.entries(value)) {
    if (USAGE_KEYS.has(key) && typeof item === "number" && Number.isFinite(item) && item >= 0) {
      usage[key] = item;
    }
  }
  return Object.keys(usage).length > 0 ? usage : null;
}

function sanitizeText(value: string, maxLength: number): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "[REDACTED]")
    .replace(
      /\b(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|secret|token)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "[REDACTED]"
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isEventKind(value: unknown): value is AgentRunEventKind {
  return typeof value === "string" && EVENT_KINDS.has(value as AgentRunEventKind);
}

function isForbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isForbiddenIpv4(address);
  if (family === 6) return isForbiddenIpv6(address);
  return true;
}

function isForbiddenIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isForbiddenIpv6(address: string): boolean {
  const segments = parseIpv6(address);
  if (!segments) return true;
  const [first, second, third, fourth, fifth, sixth] = segments;

  return (
    first === 0 ||
    (first === 0x0064 &&
      second === 0xff9b &&
      ((third === 0 && fourth === 0 && fifth === 0 && sixth === 0) || third === 1)) ||
    (first === 0x0100 && second === 0 && third === 0 && fourth === 0) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && second <= 0x01ff) ||
    (first === 0x2001 && second === 0x0db8) ||
    first === 0x2002 ||
    (first === 0x3fff && (second & 0xf000) === 0) ||
    first === 0x5f00
  );
}

function parseIpv6(address: string): number[] | null {
  let normalized = stripIpv6Brackets(address).toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = normalized.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return null;
    const octets = ipv4.split(".").map(Number);
    normalized = `${normalized.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - left.length - right.length;
  if ((halves.length === 1 && fill !== 0) || (halves.length === 2 && fill < 1)) return null;

  const values = [...left, ...Array.from({ length: fill }, () => "0"), ...right].map((part) =>
    /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : Number.NaN
  );
  return values.length === 8 && values.every(Number.isFinite) ? values : null;
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function isNoDataDnsError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return error.code === "ENODATA" || error.code === "ENOTFOUND";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
