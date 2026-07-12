"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import type { JobOpportunityInput, OpportunityDetail, OpportunityType } from "../types";
import { ConnectionOpportunityForm, type ConnectionCreationPayload } from "./ConnectionOpportunityForm";
import { JobOpportunityForm } from "./JobOpportunityForm";

async function readError(response: Response) { const body = await response.json().catch(() => null) as { error?: string } | null; return body?.error ?? `Request failed with ${response.status}`; }

export function NewOpportunityPage() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("type");
  const [type, setType] = useState<OpportunityType | null>(requested === "job" || requested === "connection" ? requested : null);
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
  return <main className="app-shell app-shell--narrow"><header className="app-header"><div><p className="app-header__eyebrow">New opportunity</p><h1 className="app-header__title">{type ? (type === "job" ? "Add a job" : "Add a connection") : "What kind of opportunity are you adding?"}</h1></div><Link className="button" href="/">Back to opportunities</Link></header>
    {error ? <div className="notice notice--error">{error}</div> : null}
    {!type ? <section className="opportunity-type-chooser"><button type="button" onClick={() => setType("job")}><strong>Job posting</strong><span>Track a role from discovery through outcome.</span></button><button type="button" onClick={() => setType("connection")}><strong>Connection</strong><span>Track a person, conversation, and future follow-up.</span></button></section>
      : <section className="tracker-panel"><button className="text-button" type="button" onClick={() => setType(null)}>← Change opportunity type</button>{type === "job" ? <JobOpportunityForm isSubmitting={saving} onSubmit={(opportunity: JobOpportunityInput) => create({ opportunity })} /> : <ConnectionOpportunityForm isSubmitting={saving} onSubmit={(payload: ConnectionCreationPayload) => create(payload)} />}</section>}
  </main>;
}
