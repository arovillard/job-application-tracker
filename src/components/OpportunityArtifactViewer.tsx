"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

import type { OpportunityArtifact } from "../types";

const ApplicationPdfPreview = dynamic(() => import("./ApplicationPdfPreview").then((module) => module.ApplicationPdfPreview), { ssr: false, loading: () => <p>Loading PDF…</p> });

function fileUrl(opportunityId: string, artifactId: string) { return `/api/opportunities/${opportunityId}/artifacts/${artifactId}/file`; }

function MarkdownArtifact({ url }: { url: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetch(url).then(async (response) => { if (!response.ok) throw new Error("Unable to read artifact"); return response.text(); }).then(setContent).catch((caught) => setError(caught.message)); }, [url]);
  if (error) return <p className="artifact-card__error">{error}</p>;
  if (content === null) return <p className="artifact-card__empty">Loading document…</p>;
  return <div className="artifact-card__markdown"><ReactMarkdown>{content}</ReactMarkdown></div>;
}

export function OpportunityArtifactViewer({ opportunityId, artifacts }: { opportunityId: string; artifacts: OpportunityArtifact[] }) {
  if (!artifacts.length) return <p className="artifact-list__empty">No resume, fit analysis, or outreach message is linked yet.</p>;
  return <div className="artifact-list">{artifacts.map((artifact) => {
    const url = fileUrl(opportunityId, artifact.id);
    return <details className="artifact-card" key={artifact.id} open={artifact.type === "fit_analysis"}><summary className="artifact-card__summary"><h3 className="artifact-card__title">{artifact.title}</h3><span className="artifact-card__meta">{artifact.contentType}</span></summary><p className="artifact-card__path">{artifact.filePath}</p>{artifact.contentType === "text/markdown" ? <MarkdownArtifact url={url} /> : artifact.contentType === "application/pdf" ? <ApplicationPdfPreview fileUrl={url} /> : <a className="artifact-card__open" href={url} target="_blank" rel="noreferrer">Open file</a>}</details>;
  })}</div>;
}
