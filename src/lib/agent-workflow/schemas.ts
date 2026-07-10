import { z } from "zod";

export const agentPreviewSchema = z
  .object({
    company: z.string(),
    role: z.string(),
    location: z.string().nullable(),
    summary: z.string(),
    postingState: z.enum(["open", "closed", "unknown"])
  })
  .strict();

export const artifactManifestEntrySchema = z
  .object({
    type: z.enum([
      "fit_analysis",
      "outreach_message",
      "referral_message",
      "cover_letter",
      "resume",
      "posting",
      "other"
    ]),
    title: z.string(),
    filePath: z.string(),
    contentType: z.string()
  })
  .strict();

export const artifactManifestSchema = z.array(artifactManifestEntrySchema);

export const PREVIEW_JSON_SCHEMA = {
  type: "object",
  properties: {
    company: { type: "string" },
    role: { type: "string" },
    location: { anyOf: [{ type: "string" }, { type: "null" }] },
    summary: { type: "string" },
    postingState: { type: "string", enum: ["open", "closed", "unknown"] }
  },
  required: ["company", "role", "location", "summary", "postingState"],
  additionalProperties: false
} as const;

export const MATERIALS_JSON_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [
          "fit_analysis",
          "outreach_message",
          "referral_message",
          "cover_letter",
          "resume",
          "posting",
          "other"
        ]
      },
      title: { type: "string" },
      filePath: { type: "string" },
      contentType: { type: "string" }
    },
    required: ["type", "title", "filePath", "contentType"],
    additionalProperties: false
  }
} as const;
