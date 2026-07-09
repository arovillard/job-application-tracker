import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getApplicationDetail } from "../../../../../../../lib/storage";

export const runtime = "nodejs";

type ArtifactFileRouteContext = {
  params: Promise<{
    id: string;
    artifactId: string;
  }>;
};

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status }
  );
}

export async function GET(_request: Request, context: ArtifactFileRouteContext) {
  const { id, artifactId } = await context.params;
  const application = getApplicationDetail(id);

  if (!application) {
    return errorResponse(new Error("Application not found"), 404);
  }

  const artifact = application.artifacts.find((item) => item.id === artifactId);

  if (!artifact) {
    return errorResponse(new Error("Artifact not found"), 404);
  }

  try {
    const body = await readFile(artifact.filePath);
    const filename = path.basename(artifact.filePath).replace(/"/g, "");

    return new Response(body, {
      headers: {
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Type": artifact.contentType
      }
    });
  } catch (error) {
    return errorResponse(error, 404);
  }
}
