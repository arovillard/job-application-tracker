"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import type { JobOpportunityInput, OpportunityDetail, OpportunityType } from "../types";
import { ConnectionOpportunityForm, type ConnectionCreationPayload } from "./ConnectionOpportunityForm";
import { JobOpportunityForm } from "./JobOpportunityForm";

async function readError(response: Response) { const body = await response.json().catch(() => null) as { error?: string } | null; return body?.error ?? `Request failed with ${response.status}`; }

export function resolveOpportunityType(value: string | null): OpportunityType {
  return value === "connection" ? "connection" : "job";
}

export function NewOpportunityPage() {
  const router = useRouter();
  const params = useSearchParams();
  const type = resolveOpportunityType(params.get("type"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async (body: unknown) => {
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/opportunities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await readError(response));
      const created = await response.json() as OpportunityDetail;
      router.push(`/opportunities/${created.id}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create opportunity"); }
    finally { setSaving(false); }
  };
  return <main className="app-shell app-shell--narrow"><header className="app-header"><div><p className="app-header__eyebrow">New opportunity</p><h1 className="app-header__title">{type === "job" ? "Add a job" : "Add a connection"}</h1></div><Link className="button" href="/">Back to opportunities</Link></header>
    {error ? <div className="notice notice--error">{error}</div> : null}
    <section className="tracker-panel">{type === "job" ? <JobOpportunityForm isSubmitting={saving} onSubmit={(opportunity: JobOpportunityInput) => create({ opportunity })} /> : <ConnectionOpportunityForm isSubmitting={saving} onSubmit={(payload: ConnectionCreationPayload) => create(payload)} />}</section>
  </main>;
}
