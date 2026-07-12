import { readFile } from "node:fs/promises";
import path from "node:path";

import { getOpportunityDetail } from "../../../../../../../lib/storage";
import { opportunityErrorResponse } from "../../../../route";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string; artifactId: string }> }) {
  const { id, artifactId } = await context.params;
  const opportunity = getOpportunityDetail(id);
  if (!opportunity) return opportunityErrorResponse(new Error("Opportunity not found"), 404);
  if (opportunity.type !== "job") return opportunityErrorResponse(new Error("Artifacts are only valid for job opportunities"), 400);
  const artifact = opportunity.artifacts.find((item) => item.id === artifactId);
  if (!artifact) return opportunityErrorResponse(new Error("Artifact not found"), 404);
  try {
    const body = await readFile(artifact.filePath);
    const filename = path.basename(artifact.filePath).replace(/"/g, "");
    return new Response(body, { headers: { "Content-Disposition": `inline; filename="${filename}"`, "Content-Type": artifact.contentType } });
  } catch (error) {
    return opportunityErrorResponse(error, 404);
  }
}
