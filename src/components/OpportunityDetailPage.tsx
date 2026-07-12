"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CONNECTION_STATUSES, JOB_STATUSES, type OpportunityDetail, type OpportunityStatus, type OpportunityTask } from "../types";
import { CONNECTION_STATUS_LABELS, JOB_STATUS_LABELS } from "./OpportunityTable";
import { OpportunityActivityTimeline } from "./OpportunityActivityTimeline";
import { OpportunityArtifactViewer } from "./OpportunityArtifactViewer";
import { OpportunityTaskList, type TaskAction } from "./OpportunityTaskList";
import { JobOpportunityForm } from "./JobOpportunityForm";

async function readError(response: Response) { const body = await response.json().catch(() => null) as { error?: string } | null; return body?.error ?? `Request failed with ${response.status}`; }

export function OpportunityDetailContent({ detail, pendingTaskId = null, onTaskAction, onStatusChange, onRecordInteraction, onCreateJob }: {
  detail: OpportunityDetail; pendingTaskId?: string | null;
  onTaskAction: (task: OpportunityTask, action: TaskAction) => void | Promise<void>;
  onStatusChange?: (status: OpportunityStatus) => void;
  onRecordInteraction?: () => void;
  onCreateJob?: () => void;
}) {
  const statuses = detail.type === "job" ? JOB_STATUSES : CONNECTION_STATUSES;
  return <>
    <nav className="detail-nav"><Link href="/">← Opportunities</Link></nav>
    <header className="app-header"><div><p className="app-header__eyebrow">{detail.type === "job" ? "Job" : "Connection"}</p><h1 className="app-header__title">{detail.label}</h1><p>{detail.organization ?? "Independent connection"}</p></div><label className="stage-select"><span className="sr-only">Opportunity stage</span><select value={detail.status} onChange={(event) => onStatusChange?.(event.target.value as OpportunityStatus)}>{statuses.map((status) => <option key={status} value={status}>{detail.type === "job" ? JOB_STATUS_LABELS[status as keyof typeof JOB_STATUS_LABELS] : CONNECTION_STATUS_LABELS[status as keyof typeof CONNECTION_STATUS_LABELS]}</option>)}</select></label></header>
    <div className="detail-action-bar"><button className="button button--primary" type="button" onClick={onRecordInteraction}>Record interaction</button>{detail.type === "connection" ? <button className="button" type="button" onClick={onCreateJob}>Create job opportunity</button> : null}</div>
    <section className="detail-grid" aria-label="Opportunity workspace"><div className="detail-grid__main">
      <section className="tracker-panel"><h2 className="tracker-panel__title">Next actions</h2><OpportunityTaskList tasks={detail.tasks} pendingTaskId={pendingTaskId} onAction={onTaskAction} /></section>
      <section className="tracker-panel"><h2 className="tracker-panel__title">Activity history</h2><OpportunityActivityTimeline activities={detail.activities} /></section>
      {detail.type === "job" ? <section className="tracker-panel"><h2 className="tracker-panel__title">Application materials</h2><OpportunityArtifactViewer opportunityId={detail.id} artifacts={detail.artifacts} /></section> : null}
    </div><aside className="detail-grid__aside"><section className="tracker-panel connection-summary"><h2 className="tracker-panel__title">Details</h2>{detail.type === "connection" ? <><p><strong>Relationship strength</strong><br />{detail.relationshipStrength[0].toUpperCase() + detail.relationshipStrength.slice(1)}</p><p><strong>Role or context</strong><br />{detail.roleContext ?? "Not set"}</p><p><strong>Met through</strong><br />{detail.meetingContext ?? "Not set"}</p>{detail.originatedJobs.length ? <div><strong>Originated jobs</strong><ul>{detail.originatedJobs.map((job) => <li key={job.id}><Link href={`/opportunities/${job.id}`}>{job.label}</Link></li>)}</ul></div> : null}</> : <><p><strong>Location</strong><br />{detail.location ?? "Not set"}</p><p><strong>Contact</strong><br />{detail.contact ?? "Not set"}</p>{detail.origin ? <p><strong>Originating connection</strong><br /><Link href={`/opportunities/${detail.origin.id}`}>{detail.origin.label}</Link></p> : null}</>}</section></aside></section>
  </>;
}

export function OpportunityDetailPage({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [showInteraction, setShowInteraction] = useState(false);
  const [showLinkedJob, setShowLinkedJob] = useState(false);
  const [body, setBody] = useState("");
  const [activityType, setActivityType] = useState("note");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");

  useEffect(() => { fetch(`/api/opportunities/${opportunityId}`, { cache: "no-store" }).then(async (response) => { if (!response.ok) throw new Error(await readError(response)); return response.json() as Promise<OpportunityDetail>; }).then(setDetail).catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load opportunity")); }, [opportunityId]);
  const mutate = async (url: string, method: string, payload: unknown) => { const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error(await readError(response)); const updated = await response.json() as OpportunityDetail; setDetail(updated); return updated; };
  const taskAction = async (task: OpportunityTask, action: TaskAction) => { setPendingTaskId(task.id); setError(null); try { await mutate(`/api/opportunities/${opportunityId}/tasks/${task.id}`, "PATCH", { action }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update task"); } finally { setPendingTaskId(null); } };
  if (error && !detail) return <main className="app-shell"><div className="notice notice--error">{error}</div><Link href="/">Back to opportunities</Link></main>;
  if (!detail) return <main className="app-shell"><p>Loading opportunity…</p></main>;
  return <main className="app-shell"><OpportunityDetailContent detail={detail} pendingTaskId={pendingTaskId} onTaskAction={taskAction} onStatusChange={(status) => void mutate(`/api/opportunities/${opportunityId}/status`, "PATCH", { status }).catch((caught) => setError(caught.message))} onRecordInteraction={() => setShowInteraction(true)} onCreateJob={() => setShowLinkedJob(true)} />
    {error ? <div className="notice notice--error">{error}</div> : null}
    {showInteraction ? <section className="tracker-panel interaction-composer"><h2>Record interaction</h2><form onSubmit={(event) => { event.preventDefault(); void mutate(`/api/opportunities/${opportunityId}/activities`, "POST", { type: activityType, body, task: taskTitle ? { title: taskTitle, dueDate: taskDueDate || null } : null }).then(() => { setShowInteraction(false); setBody(""); setTaskTitle(""); }); }}><label>Type<select value={activityType} onChange={(event) => setActivityType(event.target.value)}>{["note", "meeting", "call", "email", "message", "introduction"].map((type) => <option key={type}>{type}</option>)}</select></label><label>What happened?<textarea required value={body} onChange={(event) => setBody(event.target.value)} /></label><label>Next action<input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></label><label>Due date<input type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} /></label><button className="button button--primary" type="submit">Save interaction</button><button className="button" type="button" onClick={() => setShowInteraction(false)}>Cancel</button></form></section> : null}
    {showLinkedJob && detail.type === "connection" ? <section className="tracker-panel"><h2>Create job from {detail.label}</h2><JobOpportunityForm initialValue={{ type: "job", label: "", organization: detail.organization, status: "wishlist", priority: detail.priority, summary: null, url: null, source: "Connection", location: null, contact: `${detail.label}${detail.roleContext ? ` - ${detail.roleContext}` : ""}`, appliedDate: null, originOpportunityId: detail.id }} originOpportunityId={detail.id} onSubmit={async (input) => { const created = await mutate(`/api/opportunities/${detail.id}/jobs`, "POST", input); router.push(`/opportunities/${created.id}`); }} submitLabel="Create linked job" /><button className="button" type="button" onClick={() => setShowLinkedJob(false)}>Cancel</button></section> : null}
  </main>;
}
