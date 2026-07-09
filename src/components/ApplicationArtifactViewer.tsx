"use client";

import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";

import { type ApplicationArtifact } from "../types";

const ApplicationPdfPreview = dynamic(
  () => import("./ApplicationPdfPreview").then((module) => module.ApplicationPdfPreview),
  {
    loading: () => <p className="artifact-card__empty">Loading PDF viewer...</p>,
    ssr: false
  }
);

type ApplicationArtifactViewerProps = {
  applicationId: string;
  artifacts: ApplicationArtifact[];
};

function fileUrl(applicationId: string, artifactId: string) {
  return `/api/applications/${applicationId}/artifacts/${artifactId}/file`;
}

export function ApplicationArtifactViewer({
  applicationId,
  artifacts
}: ApplicationArtifactViewerProps) {
  if (artifacts.length === 0) {
    return <p className="artifact-list__empty">No resume, fit analysis, or outreach message is linked yet.</p>;
  }

  return (
    <div className="artifact-list">
      {artifacts.map((artifact) => (
        <details className="artifact-card" key={artifact.id} open={artifact.type === "fit_analysis"}>
          <summary className="artifact-card__summary">
            <div>
              <h3 className="artifact-card__title">{artifact.title}</h3>
            </div>
            <span className="artifact-card__meta">{artifact.contentType}</span>
          </summary>
          <p className="artifact-card__path">{artifact.filePath}</p>
          {artifact.readError ? (
            <p className="artifact-card__error">{artifact.readError}</p>
          ) : artifact.contentType === "text/markdown" && artifact.content ? (
            <div className="artifact-card__markdown">
              <ReactMarkdown>{artifact.content}</ReactMarkdown>
            </div>
          ) : artifact.contentType === "application/pdf" ? (
            <ApplicationPdfPreview fileUrl={fileUrl(applicationId, artifact.id)} />
          ) : (
            <a
              className="artifact-card__open"
              href={fileUrl(applicationId, artifact.id)}
              rel="noreferrer"
              target="_blank"
            >
              Open file
            </a>
          )}
        </details>
      ))}
    </div>
  );
}
