"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { type Application, type ApplicationInput } from "../types";
import { ApplicationForm } from "./ApplicationForm";

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed with ${response.status}`;
}

export function NewApplicationPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createApplication = async (input: ApplicationInput) => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const created = (await response.json()) as Application;
      router.push(`/applications/${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create application");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="app-shell app-shell--narrow">
      <header className="app-header">
        <div>
          <p className="app-header__eyebrow">New application</p>
          <h1 className="app-header__title">Create Application</h1>
        </div>
        <Link className="button" href="/">
          Back to dashboard
        </Link>
      </header>

      {error ? <div className="notice notice--error">{error}</div> : null}

      <section className="tracker-panel">
        <div className="tracker-panel__header">
          <h2 className="tracker-panel__title">Application details</h2>
          {saving ? <span className="tracker-panel__meta">Saving</span> : null}
        </div>
        <ApplicationForm isSubmitting={saving} onSubmit={createApplication} submitLabel="Create application" />
      </section>
    </main>
  );
}
