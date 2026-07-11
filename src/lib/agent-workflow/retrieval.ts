import { load } from "cheerio";

import { validatePublicJobUrl } from "./security";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAXIMUM_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAXIMUM_CHARACTERS = 32_000;
const DEFAULT_MAXIMUM_REDIRECTS = 5;
const USER_AGENT = "JobTracker/0.1 local-agent-preview";
const ACCEPTED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"]);

export type RetrievedPosting = {
  requestedUrl: string;
  finalUrl: string;
  context: string;
};

export type PostingRetrievalOptions = {
  fetchImpl?: typeof fetch;
  validateUrl?: (url: string) => Promise<string>;
  timeoutMs?: number;
  maximumBytes?: number;
  maximumCharacters?: number;
  maximumRedirects?: number;
};

export class PostingRetrievalError extends Error {
  readonly code = "posting_retrieval_failed" as const;

  constructor() {
    super("The public job posting could not be retrieved safely.");
    this.name = "PostingRetrievalError";
  }
}

export async function retrievePublicPosting(
  canonicalUrl: string,
  options: PostingRetrievalOptions = {}
): Promise<RetrievedPosting> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const validateUrl = options.validateUrl ?? validatePublicJobUrl;
  const maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;
  const maximumCharacters = options.maximumCharacters ?? DEFAULT_MAXIMUM_CHARACTERS;
  const maximumRedirects = options.maximumRedirects ?? DEFAULT_MAXIMUM_REDIRECTS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  timeout.unref?.();

  try {
    const requestedUrl = await validateUrl(canonicalUrl);
    let currentUrl = requestedUrl;
    const visited = new Set<string>([currentUrl]);

    for (let redirects = 0; ; redirects += 1) {
      const response = await fetchImpl(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html, application/xhtml+xml, text/plain"
        }
      });

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirects >= maximumRedirects) throw new PostingRetrievalError();
        const destination = new URL(location, currentUrl).toString();
        const validatedDestination = await validateUrl(destination);
        if (visited.has(validatedDestination)) throw new PostingRetrievalError();
        visited.add(validatedDestination);
        currentUrl = validatedDestination;
        continue;
      }

      if (!response.ok) throw new PostingRetrievalError();
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (!contentType || !ACCEPTED_CONTENT_TYPES.has(contentType)) throw new PostingRetrievalError();
      const bytes = await readBoundedBody(response, maximumBytes);
      const text = new TextDecoder().decode(bytes);
      const context = contentType === "text/plain"
        ? truncateByCodePoint(collapseWhitespace(text), maximumCharacters)
        : extractHtmlContext(text, maximumCharacters);
      if (!context) throw new PostingRetrievalError();
      return { requestedUrl, finalUrl: currentUrl, context };
    }
  } catch (error) {
    if (error instanceof PostingRetrievalError) throw error;
    throw new PostingRetrievalError();
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  if (!response.body) throw new PostingRetrievalError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new PostingRetrievalError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function extractHtmlContext(html: string, maximumCharacters: number): string {
  const $ = load(html);
  const sections: Array<{ label: string; value: string }> = [];
  addSection(sections, "Canonical URL", $("link[rel='canonical']").first().attr("href"));
  addSection(sections, "Title", $("title").first().text());
  addSection(sections, "Open Graph title", $("meta[property='og:title']").first().attr("content"));
  addSection(sections, "Description", $("meta[name='description']").first().attr("content"));
  addSection(sections, "Open Graph description", $("meta[property='og:description']").first().attr("content"));

  $("script[type='application/ld+json']").each((_index, element) => {
    try {
      collectJobPostings(JSON.parse($(element).text()), (posting) => {
        addSection(sections, "Job title", stringValue(posting.title));
        const organization = recordValue(posting.hiringOrganization);
        addSection(sections, "Company", stringValue(organization?.name));
        addSection(sections, "Location", extractLocation(posting));
        addSection(sections, "Job description", htmlToText(stringValue(posting.description)));
      });
    } catch {
      // Malformed untrusted JSON-LD is ignored while other readable content remains usable.
    }
  });

  $("script, style, nav, form, noscript, [hidden], [aria-hidden='true']").remove();
  addSection(sections, "Page text", $("body").text());

  const seen = new Set<string>();
  const output: string[] = [];
  for (const section of sections) {
    const value = collapseWhitespace(section.value);
    const normalized = value.toLocaleLowerCase();
    if (!value || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(`${section.label}: ${value}`);
  }
  return truncateByCodePoint(output.join("\n"), maximumCharacters);
}

function collectJobPostings(value: unknown, visit: (posting: Record<string, unknown>) => void) {
  if (Array.isArray(value)) {
    for (const item of value) collectJobPostings(item, visit);
    return;
  }
  const record = recordValue(value);
  if (!record) return;
  const type = record["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) visit(record);
  if (record["@graph"]) collectJobPostings(record["@graph"], visit);
}

function extractLocation(posting: Record<string, unknown>): string | undefined {
  if (posting.jobLocationType === "TELECOMMUTE") return "Remote";
  const locations = Array.isArray(posting.jobLocation) ? posting.jobLocation : [posting.jobLocation];
  const parts: string[] = [];
  for (const location of locations) {
    const address = recordValue(recordValue(location)?.address);
    if (!address) continue;
    for (const key of ["addressLocality", "addressRegion", "addressCountry"]) {
      const value = stringValue(address[key]);
      if (value) parts.push(value);
    }
  }
  return parts.length ? parts.join(", ") : undefined;
}

function htmlToText(value: string | undefined): string | undefined {
  return value ? load(`<body>${value}</body>`)("body").text() : undefined;
}

function addSection(sections: Array<{ label: string; value: string }>, label: string, value?: string) {
  if (value) sections.push({ label, value });
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function truncateByCodePoint(value: string, maximum: number): string {
  return Array.from(value).slice(0, Math.max(0, maximum)).join("");
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
