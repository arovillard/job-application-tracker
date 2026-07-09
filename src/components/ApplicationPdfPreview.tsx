"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type ApplicationPdfPreviewProps = {
  fileUrl: string;
};

export function ApplicationPdfPreview({ fileUrl }: ApplicationPdfPreviewProps) {
  const [pageCount, setPageCount] = useState<number | null>(null);

  return (
    <div className="artifact-card__pdf">
      <Document
        file={fileUrl}
        loading={<p className="artifact-card__empty">Loading PDF...</p>}
        error={<p className="artifact-card__error">Unable to load PDF preview.</p>}
        onLoadSuccess={({ numPages }) => setPageCount(numPages)}
      >
        {Array.from({ length: pageCount ?? 0 }, (_, index) => (
          <Page
            className="artifact-card__pdf-page"
            key={`pdf-page-${index + 1}`}
            pageNumber={index + 1}
            renderAnnotationLayer
            renderTextLayer
            width={720}
          />
        ))}
      </Document>
      <a className="artifact-card__open" href={fileUrl} rel="noreferrer" target="_blank">
        Open file
      </a>
    </div>
  );
}
