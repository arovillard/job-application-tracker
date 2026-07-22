import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "..");
const categoryWeights = {
  required_qualifications: 50,
  seniority_leadership: 20,
  technical_domain: 15,
  product_delivery_customer: 10,
  logistics_employment: 5
} as const;

function criterion(id: string, weight: number, evidence = "direct", mandatory = false) {
  return {
    id,
    requirement: `${id} requirement`,
    mandatory,
    evidence,
    evidenceText: evidence === "unsupported" ? "" : `${id} verified evidence`,
    rationale: `${id} rationale`,
    weight
  };
}

function assessment() {
  return {
    schemaVersion: 1,
    posting: {
      url: "https://example.com/jobs/engineering-manager",
      organization: "Example Co",
      role: "Engineering Manager",
      source: "Example careers",
      state: "open",
      location: "Remote — Example Country",
      evaluatedAt: "2026-07-22T16:00:00.000Z"
    },
    groups: Object.entries(categoryWeights).map(([name, weight]) => ({
      name,
      criteria: [criterion(`${name}-1`, weight, "direct", name === "required_qualifications")]
    })),
    blockers: [] as Array<{ code: string; requirement: string; evidence: string }>
  };
}

function run(input: unknown) {
  return spawnSync(process.execPath, ["scripts/evaluate-job-match.mjs", "--input-json", "-"], {
    cwd: projectRoot,
    encoding: "utf8",
    input: JSON.stringify(input)
  });
}

function score(input: ReturnType<typeof assessment>) {
  const result = run(input);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

describe("evaluate-job-match", () => {
  it("returns the passing threshold assessment", () => {
    const input = assessment();
    input.groups[0].criteria = [
      criterion("required-direct", 40, "direct", true),
      criterion("required-unsupported", 10, "unsupported", true)
    ];
    input.groups[3].criteria = [criterion("product-unsupported", 10, "unsupported")];

    expect(score(input)).toEqual({
      schemaVersion: 1,
      overallScore: 80,
      mandatoryMatch: 80,
      seniorityMatch: 100,
      eligible: true,
      reasons: [],
      categoryScores: {
        required_qualifications: { available: 50, earned: 40 },
        seniority_leadership: { available: 20, earned: 20 },
        technical_domain: { available: 15, earned: 15 },
        product_delivery_customer: { available: 10, earned: 0 },
        logistics_employment: { available: 5, earned: 5 }
      }
    });
  });

  it("exports an evaluator without executing the CLI", async () => {
    // @ts-expect-error JavaScript production module intentionally has no declaration file.
    const { evaluateJobMatch } = await import("./evaluate-job-match.mjs");
    expect(evaluateJobMatch(assessment())).toMatchObject({ eligible: true, overallScore: 100 });
  });

  it.each([["closed", "posting_not_open"], ["unknown", "posting_not_open"]])("rejects posting state %s", (state, code) => {
    const input = assessment();
    input.posting.state = state;
    const result = score(input);
    expect(result.eligible).toBe(false);
    expect(result.reasons.map((reason: { code: string }) => reason.code)).toContain(code);
  });

  it("rejects an exact 79 score while independent mandatory and seniority gates pass", () => {
    const input = assessment();
    input.groups[0].criteria = [criterion("required-mandatory", 40, "direct", true), criterion("required-miss", 10, "unsupported")];
    input.groups[2].criteria = [criterion("technical-direct", 14), criterion("technical-miss", 1, "unsupported")];
    input.groups[3].criteria = [criterion("product-miss", 10, "unsupported")];
    const result = score(input);
    expect(result).toMatchObject({ overallScore: 79, mandatoryMatch: 100, seniorityMatch: 100, eligible: false });
    expect(result.reasons[0].code).toBe("overall_below_threshold");
  });

  it("keeps an exact 79.5 score below the overall threshold", () => {
    const input = assessment();
    input.groups[0].criteria = [criterion("required-direct", 29, "direct", true), criterion("required-adjacent", 21, "adjacent")];
    input.groups[3].criteria = [criterion("product-miss", 10, "unsupported")];
    const result = score(input);
    expect(result.overallScore).toBe(79.5);
    expect(result.eligible).toBe(false);
    expect(result.reasons[0].code).toBe("overall_below_threshold");
  });

  it("rejects an 80-or-higher overall score when mandatory match is below 80", () => {
    const input = assessment();
    input.groups[0].criteria = [criterion("required-direct", 40), criterion("required-mandatory", 10, "unsupported", true)];
    const result = score(input);
    expect(result).toMatchObject({ overallScore: 90, mandatoryMatch: 0, eligible: false });
    expect(result.reasons[0].code).toBe("mandatory_below_threshold");
  });

  it("rejects an 80-or-higher overall score when seniority is below 75", () => {
    const input = assessment();
    input.groups[1].criteria = [criterion("seniority-direct", 14), criterion("seniority-miss", 6, "unsupported")];
    const result = score(input);
    expect(result).toMatchObject({ overallScore: 94, seniorityMatch: 70, eligible: false });
    expect(result.reasons[0].code).toBe("seniority_below_threshold");
  });

  it("rejects an otherwise perfect assessment with a non-negotiable blocker", () => {
    const input = assessment();
    input.blockers = [{ code: "work_authorization", requirement: "US work authorization", evidence: "not verified" }];
    const result = score(input);
    expect(result.eligible).toBe(false);
    expect(result.reasons[0].code).toBe("non_negotiable_blocker");
  });

  it("reports simultaneous gate failures in stable order", () => {
    const input = assessment();
    input.posting.state = "closed";
    input.groups[0].criteria = [criterion("required-miss", 50, "unsupported", true)];
    input.groups[1].criteria = [criterion("seniority-miss", 20, "unsupported")];
    input.blockers = [{ code: "work_authorization", requirement: "US work authorization", evidence: "not verified" }];
    expect(score(input).reasons.map((reason: { code: string }) => reason.code)).toEqual([
      "posting_not_open",
      "overall_below_threshold",
      "mandatory_below_threshold",
      "seniority_below_threshold",
      "non_negotiable_blocker"
    ]);
  });

  it("awards adjacent evidence exactly half credit", () => {
    const input = assessment();
    input.groups[2].criteria = [criterion("technical-adjacent", 15, "adjacent")];
    expect(score(input).categoryScores.technical_domain).toEqual({ available: 15, earned: 7.5 });
  });

  it("rounds display scores to one decimal without changing exact gate comparisons", () => {
    const input = assessment();
    input.groups[0].criteria = [criterion("required-direct", 29, "direct", true), criterion("required-adjacent", 21, "adjacent")];
    input.groups[3].criteria = [criterion("product-miss", 10, "unsupported")];
    const result = score(input);
    expect(result.overallScore).toBe(79.5);
    expect(result.mandatoryMatch).toBe(100);
  });

  it.each([
    ["unsupported schema version", (input: ReturnType<typeof assessment>) => input.schemaVersion = 2, /schemaVersion/i],
    ["missing category", (input: ReturnType<typeof assessment>) => input.groups.pop(), /exactly the required categories/i],
    ["unknown category", (input: ReturnType<typeof assessment>) => input.groups[0].name = "culture_fit", /unknown category/i],
    ["duplicate category", (input: ReturnType<typeof assessment>) => input.groups[1].name = input.groups[0].name, /duplicate category/i],
    ["wrong category total", (input: ReturnType<typeof assessment>) => input.groups[0].criteria[0].weight = 49, /must sum to 50/i],
    ["fractional criterion weight", (input: ReturnType<typeof assessment>) => input.groups[0].criteria[0].weight = 49.5, /positive integer/i],
    ["unknown evidence", (input: ReturnType<typeof assessment>) => input.groups[0].criteria[0].evidence = "likely", /evidence/i],
    ["credited evidence without text", (input: ReturnType<typeof assessment>) => input.groups[0].criteria[0].evidenceText = "", /evidenceText/i],
    ["unsupported evidence without evidenceText", (input: ReturnType<typeof assessment>) => { input.groups[0].criteria[0].evidence = "unsupported"; delete (input.groups[0].criteria[0] as { evidenceText?: string }).evidenceText; }, /evidenceText/i],
    ["unsupported evidence with non-string evidenceText", (input: ReturnType<typeof assessment>) => { input.groups[0].criteria[0].evidence = "unsupported"; (input.groups[0].criteria[0] as { evidenceText: unknown }).evidenceText = 1; }, /evidenceText/i],
    ["non-boolean mandatory", (input: ReturnType<typeof assessment>) => (input.groups[0].criteria[0] as { mandatory: unknown }).mandatory = "yes", /mandatory/i],
    ["no mandatory criteria", (input: ReturnType<typeof assessment>) => input.groups.flatMap(group => group.criteria).forEach(item => item.mandatory = false), /mandatory criterion/i],
    ["malformed blocker", (input: ReturnType<typeof assessment>) => input.blockers = [{ code: "", requirement: "x", evidence: "y" }], /blocker/i]
  ])("rejects %s", (_name, mutate, message) => {
    const input = assessment();
    mutate(input);
    const result = run(input);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(message);
  });
});
