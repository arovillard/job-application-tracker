import { load } from "cheerio";

import { validatePublicJobUrl } from "./security";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAXIMUM_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAXIMUM_CHARACTERS = 32_000;
const DEFAULT_MAXIMUM_REDIRECTS = 5;
const USER_AGENT = "JobTracker/0.1 local-agent-preview";
const ACCEPTED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"]);

export type StructuredJobPosting = {
  title: string;
  company: string;
  description: string;
};

export type RetrievedPosting = {
  requestedUrl: string;
  finalUrl: string;
  context: string;
  structuredJobPosting: StructuredJobPosting | null;
};

export type PostingRetrievalOptions = {
  fetchImpl?: typeof fetch;
  validateUrl?: (url: string) => Promise<string>;
  signal?: AbortSignal;
  onInitialValidated?: () => void;
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
  let rejectBoundary!: (error: PostingRetrievalError) => void;
  const boundary = new Promise<never>((_resolve, reject) => { rejectBoundary = reject; });
  const stop = () => {
    controller.abort();
    rejectBoundary(new PostingRetrievalError());
  };
  const timeout = setTimeout(() => {
    stop();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  timeout.unref?.();
  options.signal?.addEventListener("abort", stop, { once: true });
  let currentResponse: Response | null = null;

  try {
    if (options.signal?.aborted) stop();
    const requestedUrl = await beforeDeadline(
      Promise.resolve().then(() => validateUrl(canonicalUrl)),
      boundary
    );
    options.onInitialValidated?.();
    let currentUrl = requestedUrl;
    const visited = new Set<string>([currentUrl]);

    for (let redirects = 0; ; redirects += 1) {
      const fetchOperation = Promise.resolve().then(() => fetchImpl(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html, application/xhtml+xml, text/plain"
        }
      })).then((response) => {
        if (controller.signal.aborted) cancelResponseBody(response);
        return response;
      });
      const response = await beforeDeadline(fetchOperation, boundary);
      currentResponse = response;

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirects >= maximumRedirects) throw new PostingRetrievalError();
        const destination = new URL(location, currentUrl).toString();
        cancelResponseBody(response);
        currentResponse = null;
        const validatedDestination = await beforeDeadline(
          Promise.resolve().then(() => validateUrl(destination)),
          boundary
        );
        if (visited.has(validatedDestination)) throw new PostingRetrievalError();
        visited.add(validatedDestination);
        currentUrl = validatedDestination;
        continue;
      }

      if (!response.ok) throw new PostingRetrievalError();
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (!contentType || !ACCEPTED_CONTENT_TYPES.has(contentType)) throw new PostingRetrievalError();
      const bytes = await readBoundedBody(response, maximumBytes, boundary);
      currentResponse = null;
      const text = new TextDecoder().decode(bytes);
      const extracted = contentType === "text/plain"
        ? {
            context: truncateByCodePoint(collapseWhitespace(text), maximumCharacters),
            structuredJobPosting: null
          }
        : extractHtmlContext(text, maximumCharacters, currentUrl);
      const { context, structuredJobPosting } = extracted;
      if (!context) throw new PostingRetrievalError();
      return { requestedUrl, finalUrl: currentUrl, context, structuredJobPosting };
    }
  } catch (error) {
    controller.abort();
    if (currentResponse) cancelResponseBody(currentResponse);
    if (error instanceof PostingRetrievalError) throw error;
    throw new PostingRetrievalError();
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", stop);
  }
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
  deadline: Promise<never>
): Promise<Uint8Array> {
  if (!response.body) throw new PostingRetrievalError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await beforeDeadline(reader.read(), deadline);
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        throw new PostingRetrievalError();
      }
      chunks.push(value);
    }
  } catch (error) {
    cancelReader(reader);
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* A pending uncooperative read may retain the lock. */ }
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function beforeDeadline<T>(operation: Promise<T>, deadline: Promise<never>): Promise<T> {
  return Promise.race([operation, deadline]);
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    void reader.cancel().catch(() => {});
  } catch {
    // Cancellation is best-effort after the host deadline has already failed safely.
  }
}

function cancelResponseBody(response: Response) {
  if (!response.body) return;
  try {
    void response.body.cancel().catch(() => {});
  } catch {
    // A locked body is cancelled by its reader instead.
  }
}

function extractHtmlContext(
  html: string,
  maximumCharacters: number,
  finalUrl: string
): Pick<RetrievedPosting, "context" | "structuredJobPosting"> {
  const $ = load(html);
  const sections: Array<{ label: string; value: string }> = [];
  let structuredJobPosting: StructuredJobPosting | null = null;
  const documentTitle = $("title").first().text();
  addSection(sections, "Canonical URL", $("link[rel='canonical']").first().attr("href"));
  addSection(sections, "Title", $("title").first().text());
  addSection(sections, "Open Graph title", $("meta[property='og:title']").first().attr("content"));
  addSection(sections, "Description", $("meta[name='description']").first().attr("content"));
  addSection(sections, "Open Graph description", $("meta[property='og:description']").first().attr("content"));

  $("script[type='application/ld+json'], [itemscope][itemtype]").each((_index, element) => {
    if ($(element).is("script[type='application/ld+json']")) {
      try {
        collectJobPostings(JSON.parse($(element).text()), (posting) => {
          const title = normalizedValue(stringValue(posting.title));
          const organization = recordValue(posting.hiringOrganization);
          const company = normalizedValue(stringValue(organization?.name));
          const description = normalizedValue(htmlToText(stringValue(posting.description)));
          structuredJobPosting ??= completeStructuredPosting(title, company, description);
          addSection(sections, "Job title", title);
          addSection(sections, "Company", company);
          addSection(sections, "Location", extractLocation(posting));
          addSection(sections, "Job description", description);
        });
      } catch {
        // Malformed untrusted JSON-LD is ignored while other readable content remains usable.
      }
      return;
    }
    if (!structuredJobPosting) {
      const itemTypes = ($(element).attr("itemtype") ?? "").split(/\s+/u);
      if (!itemTypes.some(isSchemaJobPostingUrl)) return;
      const title = readScopedMicrodataProperty($, element, "title");
      const description = readScopedMicrodataProperty($, element, "description");
      const organization = $(element)
        .find("[itemscope][itemprop~='hiringOrganization']")
        .toArray()
        .find((candidate) => $(candidate).parents("[itemscope]").first().get(0) === element);
      const company = organization
        ? readScopedMicrodataProperty($, organization, "name")
        : undefined;
      structuredJobPosting = completeStructuredPosting(title, company, description);
    }
  });

  $("script, style, nav, form, noscript, [hidden], [aria-hidden='true']").remove();
  const pageText = collapseWhitespace($("body").text());
  structuredJobPosting ??= extractLinkedInJobPosting(finalUrl, documentTitle, pageText);
  addSection(sections, "Page text", pageText);

  const seen = new Set<string>();
  const output: string[] = [];
  for (const section of sections) {
    const value = collapseWhitespace(section.value);
    const normalized = value.toLocaleLowerCase();
    if (!value || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(`${section.label}: ${value}`);
  }
  return {
    context: truncateByCodePoint(output.join("\n"), maximumCharacters),
    structuredJobPosting
  };
}

function extractLinkedInJobPosting(
  finalUrl: string,
  documentTitle: string,
  pageText: string
): StructuredJobPosting | null {
  let url: URL;
  try {
    url = new URL(finalUrl);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname !== "linkedin.com" && !hostname.endsWith(".linkedin.com")) return null;
  if (!url.pathname.startsWith("/jobs/view/")) return null;

  const title = normalizedValue(documentTitle);
  const match = title?.match(/^(.+?) hiring (.+?) in .+ \| LinkedIn$/u);
  if (!match) return null;
  return completeStructuredPosting(
    normalizedValue(match[2]),
    normalizedValue(match[1]),
    normalizedValue(pageText)
  );
}

function completeStructuredPosting(
  title: string | undefined,
  company: string | undefined,
  description: string | undefined
): StructuredJobPosting | null {
  return title && company && description ? { title, company, description } : null;
}

function readScopedMicrodataProperty(
  $: ReturnType<typeof load>,
  scope: Parameters<ReturnType<typeof load>>[0],
  property: string
): string | undefined {
  const element = $(scope)
    .find(`[itemprop~='${property}']`)
    .toArray()
    .find((candidate) => $(candidate).parents("[itemscope]").first().get(0) === scope);
  if (!element) return undefined;
  return normalizedValue($(element).attr("content")) ?? normalizedValue($(element).text());
}

function normalizedValue(value: string | undefined): string | undefined {
  const normalized = value ? collapseWhitespace(value) : "";
  return normalized || undefined;
}

function collectJobPostings(value: unknown, visit: (posting: Record<string, unknown>) => void) {
  if (Array.isArray(value)) {
    for (const item of value) collectJobPostings(item, visit);
    return;
  }
  const record = recordValue(value);
  if (!record) return;
  if (isJobPostingType(record["@type"])) visit(record);
  if (record["@graph"]) collectJobPostings(record["@graph"], visit);
}

function isJobPostingType(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isJobPostingType);
  if (typeof value !== "string") return false;
  return value === "JobPosting" || isSchemaJobPostingUrl(value);
}

function isSchemaJobPostingUrl(value: string): boolean {
  return /^https?:\/\/(?:www\.)?schema\.org\/JobPosting\/?$/iu.test(value);
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
