import { describe, expect, it, vi } from "vitest";

import { PostingRetrievalError, retrievePublicPosting } from "./retrieval";

function response(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html", ...init.headers },
    ...init
  });
}

async function expectSafeFailure(promise: Promise<unknown>) {
  const error = await promise.catch((caught) => caught);
  expect(error).toBeInstanceOf(PostingRetrievalError);
  if (!(error instanceof PostingRetrievalError)) throw error;
  expect(error).toMatchObject({ code: "posting_retrieval_failed" });
  expect(error.message).toBe("The public job posting could not be retrieved safely.");
  return error as Error;
}

async function settleWithin(promise: Promise<unknown>, maximumMs = 100) {
  return Promise.race([
    promise.catch((error) => error),
    new Promise<"test-timeout">((resolve) => setTimeout(() => resolve("test-timeout"), maximumMs))
  ]);
}

function trackedStream(onCancel: () => void, uncooperative = false) {
  return new ReadableStream<Uint8Array>({
    pull() {
      if (uncooperative) return new Promise<void>(() => {});
    },
    cancel() {
      onCancel();
      return uncooperative ? new Promise<void>(() => {}) : undefined;
    }
  });
}

describe("retrievePublicPosting", () => {
  it("extracts bounded context from a LinkedIn-like guest posting", async () => {
    const html = `<!doctype html><html><head>
      <link rel="canonical" href="https://ca.linkedin.com/jobs/view/technical-director-4437590390">
      <meta property="og:title" content="Technical Director at Thrillworks">
      <meta name="description" content="Lead technical strategy and delivery.">
      <script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Technical Director",
        hiringOrganization: { name: "Thrillworks" },
        jobLocationType: "TELECOMMUTE",
        description: "Lead architecture and engineering delivery."
      })}</script>
    </head><body><main>Technical Director Thrillworks Lead architecture.</main></body></html>`;
    const result = await retrievePublicPosting("https://www.linkedin.com/jobs/view/4437590390", {
      fetchImpl: async () => response(html),
      validateUrl: async (url) => url
    });
    expect(result.finalUrl).toContain("linkedin.com/jobs/view");
    expect(result.context).toContain("Technical Director");
    expect(result.context).toContain("Thrillworks");
    expect(result.context).not.toContain("<script");
    expect(result.context.length).toBeLessThanOrEqual(32_000);
  });

  it("retrieves bounded plain text", async () => {
    const result = await retrievePublicPosting("https://jobs.example/role", {
      fetchImpl: async () => response("Senior Engineer at Acme", { headers: { "content-type": "text/plain" } }),
      validateUrl: async (url) => url,
      maximumCharacters: 8
    });
    expect(result.context).toBe("Senior E");
  });

  it("announces initial validation before fetch without exposing URL data", async () => {
    const order: string[] = [];
    const callback = vi.fn(() => order.push("validated"));
    await retrievePublicPosting("https://jobs.example/role", {
      validateUrl: async () => { order.push("validate"); return "https://jobs.example/role"; },
      onInitialValidated: callback,
      fetchImpl: async () => {
        order.push("fetch");
        return response("Public role", { headers: { "content-type": "text/plain" } });
      }
    });
    expect(order).toEqual(["validate", "validated", "fetch"]);
    expect(callback).toHaveBeenCalledWith();
  });

  it("removes its external abort listener after success", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await retrievePublicPosting("https://jobs.example/role", {
      signal: controller.signal,
      validateUrl: async (url) => url,
      fetchImpl: async () => response("Public role", { headers: { "content-type": "text/plain" } })
    });
    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(remove.mock.calls[0][1]).toBe(add.mock.calls[0][1]);
  });

  it("revalidates and follows a valid relative redirect", async () => {
    const validateUrl = vi.fn(async (url: string) => url);
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/start")
        ? response("", { status: 302, headers: { location: "/final", "content-type": "text/plain" } })
        : response("Public role", { headers: { "content-type": "text/plain" } })
    );
    const result = await retrievePublicPosting("https://jobs.example/start", { fetchImpl, validateUrl });
    expect(result.finalUrl).toBe("https://jobs.example/final");
    expect(validateUrl).toHaveBeenNthCalledWith(2, "https://jobs.example/final");
  });

  it("rejects a private redirect before fetching it", async () => {
    const fetchImpl = vi.fn(async () => response("", { status: 302, headers: { location: "http://127.0.0.1/admin" } }));
    await expectSafeFailure(retrievePublicPosting("https://jobs.example/start", {
      fetchImpl,
      validateUrl: async (url) => {
        if (url.includes("127.0.0.1")) throw new Error("private 127.0.0.1");
        return url;
      }
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects embedded URL credentials before fetching", async () => {
    const fetchImpl = vi.fn();
    await expectSafeFailure(retrievePublicPosting("https://user:secret@jobs.example/role", { fetchImpl }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a sixth redirect", async () => {
    let count = 0;
    await expectSafeFailure(retrievePublicPosting("https://jobs.example/0", {
      fetchImpl: async () => response("", { status: 302, headers: { location: `https://jobs.example/${++count}` } }),
      validateUrl: async (url) => url
    }));
    expect(count).toBe(6);
  });

  it("rejects a redirect loop", async () => {
    await expectSafeFailure(retrievePublicPosting("https://jobs.example/a", {
      fetchImpl: async (url) => response("", { status: 302, headers: { location: String(url).endsWith("/a") ? "/b" : "/a" } }),
      validateUrl: async (url) => url
    }));
  });

  it("rejects a timeout safely", async () => {
    await expectSafeFailure(retrievePublicPosting("https://jobs.example/role", {
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("secret timeout target")));
      }),
      validateUrl: async (url) => url,
      timeoutMs: 1
    }));
  });

  it("applies the deadline to a hanging initial validator", async () => {
    const outcome = await settleWithin(retrievePublicPosting("https://jobs.example/role", {
      fetchImpl: vi.fn(),
      validateUrl: async () => new Promise<string>(() => {}),
      timeoutMs: 5
    }));
    expect(outcome).toBeInstanceOf(PostingRetrievalError);
  });

  it("applies the same deadline to a hanging redirect validator and cancels its body", async () => {
    let cancellations = 0;
    const outcome = await settleWithin(retrievePublicPosting("https://jobs.example/start", {
      fetchImpl: async () => new Response(trackedStream(() => { cancellations += 1; }), {
        status: 302,
        headers: { location: "/final" }
      }),
      validateUrl: vi.fn()
        .mockResolvedValueOnce("https://jobs.example/start")
        .mockImplementationOnce(async () => new Promise<string>(() => {})),
      timeoutMs: 5
    }));
    expect(outcome).toBeInstanceOf(PostingRetrievalError);
    expect(cancellations).toBe(1);
  });

  it("fails safely when a response body never produces data and ignores cancellation", async () => {
    let cancellations = 0;
    const outcome = await settleWithin(retrievePublicPosting("https://jobs.example/role", {
      fetchImpl: async () => new Response(trackedStream(() => { cancellations += 1; }, true), {
        headers: { "content-type": "text/plain" }
      }),
      validateUrl: async (url) => url,
      timeoutMs: 5
    }));
    expect(outcome).toBeInstanceOf(PostingRetrievalError);
    expect(cancellations).toBe(1);
  });

  it.each(["initial validation", "redirect validation", "fetch", "stream read"])(
    "promptly cancels hanging %s through the external signal",
    async (boundary) => {
      const controller = new AbortController();
      let cancellations = 0;
      const validateUrl = vi.fn(async (url: string) => {
        if (boundary === "initial validation" ||
            (boundary === "redirect validation" && validateUrl.mock.calls.length === 2)) {
          return new Promise<string>(() => {});
        }
        return url;
      });
      const fetchImpl = vi.fn(async () => {
        if (boundary === "fetch") return new Promise<Response>(() => {});
        if (boundary === "redirect validation") {
          return new Response(trackedStream(() => { cancellations += 1; }), {
            status: 302,
            headers: { location: "/final" }
          });
        }
        return new Response(trackedStream(() => { cancellations += 1; }, boundary === "stream read"), {
          headers: { "content-type": "text/plain" }
        });
      });
      setTimeout(() => controller.abort(), 5);

      const outcome = await settleWithin(retrievePublicPosting("https://jobs.example/role", {
        fetchImpl,
        validateUrl,
        signal: controller.signal,
        timeoutMs: 5_000
      }), 100);

      expect(outcome).toBeInstanceOf(PostingRetrievalError);
      if (boundary === "redirect validation" || boundary === "stream read") {
        expect(cancellations).toBe(1);
      }
    }
  );

  it.each([
    ["redirect", 302, { location: "/final" }],
    ["non-2xx", 503, { "content-type": "text/plain" }],
    ["unsupported", 200, { "content-type": "application/pdf" }]
  ])("cancels the %s response body on early exit", async (_label, status, headers) => {
    let cancellations = 0;
    let requests = 0;
    await expectSafeFailure(retrievePublicPosting("https://jobs.example/start", {
      fetchImpl: async () => {
        requests += 1;
        if (status === 302 && requests > 1) throw new Error("stop after redirect");
        return new Response(trackedStream(() => { cancellations += 1; }), { status, headers });
      },
      validateUrl: async (url) => url
    }));
    expect(cancellations).toBe(1);
  });

  it("rejects non-2xx responses", async () => {
    await expectSafeFailure(retrievePublicPosting("https://jobs.example/role", {
      fetchImpl: async () => response("private upstream details", { status: 503 }),
      validateUrl: async (url) => url
    }));
  });

  it("rejects unsupported content types", async () => {
    await expectSafeFailure(retrievePublicPosting("https://jobs.example/role", {
      fetchImpl: async () => response("%PDF-private", { headers: { "content-type": "application/pdf" } }),
      validateUrl: async (url) => url
    }));
  });

  it("rejects empty extraction", async () => {
    await expectSafeFailure(retrievePublicPosting("https://jobs.example/role", {
      fetchImpl: async () => response("<html><body><nav>Only navigation</nav><script>secret()</script></body></html>"),
      validateUrl: async (url) => url
    }));
  });

  it("rejects a stream exceeding the byte ceiling", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      }
    });
    await expectSafeFailure(retrievePublicPosting("https://jobs.example/role", {
      fetchImpl: async () => new Response(stream, { headers: { "content-type": "text/plain" } }),
      validateUrl: async (url) => url
    }));
  });

  it("tolerates malformed JSON-LD and still extracts the body", async () => {
    const result = await retrievePublicPosting("https://jobs.example/role", {
      fetchImpl: async () => response("<html><body><script type='application/ld+json'>{bad</script><main>Platform Engineer at Acme</main></body></html>"),
      validateUrl: async (url) => url
    });
    expect(result.context).toContain("Platform Engineer at Acme");
  });

  it("removes duplicate normalized sections", async () => {
    const result = await retrievePublicPosting("https://jobs.example/role", {
      fetchImpl: async () => response("<html><head><title>Platform Engineer</title><meta property='og:title' content=' Platform   Engineer '></head><body>Platform Engineer</body></html>"),
      validateUrl: async (url) => url
    });
    expect(result.context.match(/Platform Engineer/g)).toHaveLength(1);
  });

  it("never exposes forbidden raw values in its error", async () => {
    const forbidden = ["secret-cookie=abc", "x-private-header", "10.0.0.7", "<raw-html>"];
    const error = await expectSafeFailure(retrievePublicPosting("https://jobs.example/role", {
      fetchImpl: async () => { throw new Error(forbidden.join(" ")); },
      validateUrl: async (url) => url
    }));
    for (const value of forbidden) expect(String(error)).not.toContain(value);
  });
});
