"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { CONNECTION_STATUSES, JOB_STATUSES, type OpportunityDetail, type OpportunityStatus, type OpportunityTask } from "../types";
import { CONNECTION_STATUS_LABELS, JOB_STATUS_LABELS } from "./OpportunityTable";
import { OpportunityActivityTimeline } from "./OpportunityActivityTimeline";
import { OpportunityArtifactViewer } from "./OpportunityArtifactViewer";
import { OpportunityTaskList, type TaskAction } from "./OpportunityTaskList";
import { JobOpportunityForm } from "./JobOpportunityForm";
import { ConnectionOpportunityForm } from "./ConnectionOpportunityForm";
import { DetailActionsMenu } from "./DetailActionsMenu";
import { Modal } from "./Modal";
import { deleteOpportunityRequest } from "../lib/opportunity-detail-mutations";

async function readError(response: Response) { const body = await response.json().catch(() => null) as { error?: string } | null; return body?.error ?? `Request failed with ${response.status}`; }
const humanActivityTypes = ["note", "meeting", "call", "email", "message", "introduction"] as const;
function mergeActivities(current: OpportunityDetail["activities"], incoming: OpportunityDetail["activities"]) {
  const byId = new Map(current.map((activity) => [activity.id, activity]));
  for (const activity of incoming) {
    const existing = byId.get(activity.id);
    if (!existing || activity.occurredAt.localeCompare(existing.occurredAt) >= 0 && activity.createdAt.localeCompare(existing.createdAt) >= 0) byId.set(activity.id, activity);
  }
  return [...byId.values()].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
}
function mergeTaskResult(current: OpportunityDetail, next: OpportunityDetail): OpportunityDetail { return { ...current, tasks: next.tasks, activities: mergeActivities(current.activities, next.activities), updatedAt: next.updatedAt } as OpportunityDetail; }
function mergeStatusResult(current: OpportunityDetail, next: OpportunityDetail): OpportunityDetail { return { ...current, status: next.status, activities: mergeActivities(current.activities, next.activities), updatedAt: next.updatedAt } as OpportunityDetail; }

export function InteractionComposer({ activityType, body, occurredDate, taskTitle, taskDueDate, isSubmitting = false, onActivityTypeChange, onBodyChange, onOccurredDateChange, onTaskTitleChange, onTaskDueDateChange, onSubmit, onCancel }: {
  activityType: typeof humanActivityTypes[number]; body: string; occurredDate: string; taskTitle: string; taskDueDate: string;
  isSubmitting?: boolean;
  onActivityTypeChange: (value: typeof humanActivityTypes[number]) => void; onBodyChange: (value: string) => void; onOccurredDateChange: (value: string) => void; onTaskTitleChange: (value: string) => void; onTaskDueDateChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void;
}) {
  return <form className="application-form" onSubmit={onSubmit}><div className="application-form__grid">
    <label className="application-form__field"><span className="application-form__label">Type</span><select className="application-form__select" value={activityType} onChange={(event) => onActivityTypeChange(event.target.value as typeof activityType)}>{humanActivityTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
    <label className="application-form__field"><span className="application-form__label">What happened?</span><textarea className="application-form__textarea" required value={body} onChange={(event) => onBodyChange(event.target.value)} /></label>
    <label className="application-form__field"><span className="application-form__label">Occurred on</span><input className="application-form__input" type="date" value={occurredDate} onChange={(event) => onOccurredDateChange(event.target.value)} /></label>
    <label className="application-form__field"><span className="application-form__label">Next action</span><input className="application-form__input" value={taskTitle} onChange={(event) => onTaskTitleChange(event.target.value)} /></label>
    <label className="application-form__field"><span className="application-form__label">Due date</span><input className="application-form__input" type="date" value={taskDueDate} onChange={(event) => onTaskDueDateChange(event.target.value)} /></label>
  </div><div className="application-form__actions"><button className="button button--primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Saving…" : "Save interaction"}</button><button className="button" type="button" onClick={onCancel}>Cancel</button></div></form>;
}

export function TaskComposer({ taskTitle, taskDueDate, isSubmitting = false, onTaskTitleChange, onTaskDueDateChange, onSubmit, onCancel }: {
  taskTitle: string; taskDueDate: string; onTaskTitleChange: (value: string) => void; onTaskDueDateChange: (value: string) => void;
  isSubmitting?: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void;
}) {
  return <form className="application-form" onSubmit={onSubmit}><div className="application-form__grid">
    <label className="application-form__field"><span className="application-form__label">Task</span><input className="application-form__input" required value={taskTitle} onChange={(event) => onTaskTitleChange(event.target.value)} /></label>
    <label className="application-form__field"><span className="application-form__label">Due date</span><input className="application-form__input" type="date" value={taskDueDate} onChange={(event) => onTaskDueDateChange(event.target.value)} /></label>
  </div><div className="application-form__actions"><button className="button button--primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Saving…" : "Add task"}</button><button className="button" type="button" onClick={onCancel}>Cancel</button></div></form>;
}

export function TrackerPanel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return <section className={["tracker-panel", className].filter(Boolean).join(" ")}><header className="tracker-panel__header"><h2 className="tracker-panel__title">{title}</h2></header>{children}</section>;
}

export function OpportunityDetailContent({ detail, pendingTaskId = null, onTaskAction, onStatusChange, onRecordInteraction, onAddTask, onCreateJob, onEdit, onArchive, onDelete }: {
  detail: OpportunityDetail; pendingTaskId?: string | null;
  onTaskAction: (task: OpportunityTask, action: TaskAction, dueDate?: string | null) => void | Promise<void>;
  onStatusChange?: (status: OpportunityStatus) => void; onRecordInteraction?: (trigger: HTMLButtonElement) => void; onAddTask?: (trigger: HTMLButtonElement) => void;
  onCreateJob?: () => void; onEdit?: () => void; onArchive?: () => void; onDelete?: () => void;
}) {
  const statuses = detail.type === "job" ? JOB_STATUSES : CONNECTION_STATUSES;
  return <>
    <nav className="detail-nav"><Link className="detail-nav__back" href="/">← Opportunities</Link></nav>
    <header className="app-header"><div><p className="app-header__eyebrow">{detail.type === "job" ? "Job" : "Connection"}</p><h1 className="app-header__title">{detail.label}</h1><p>{detail.organization ?? "Independent connection"} · Priority: {detail.priority}</p></div><label className="stage-select"><span className="sr-only">Opportunity stage</span><select value={detail.status} onChange={(event) => onStatusChange?.(event.target.value as OpportunityStatus)}>{statuses.map((status) => <option key={status} value={status}>{detail.type === "job" ? JOB_STATUS_LABELS[status as keyof typeof JOB_STATUS_LABELS] : CONNECTION_STATUS_LABELS[status as keyof typeof CONNECTION_STATUS_LABELS]}</option>)}</select></label></header>
    <div className="detail-action-bar"><button className="button button--primary" type="button" onClick={(event) => onRecordInteraction?.(event.currentTarget)}>Record interaction</button><button className="button" type="button" onClick={(event) => onAddTask?.(event.currentTarget)}>Add task</button><DetailActionsMenu hasLinkedJob={detail.type === "connection"} onArchive={() => onArchive?.()} onCreateLinkedJob={() => onCreateJob?.()} onDelete={() => onDelete?.()} onEdit={() => onEdit?.()} /></div>
    <section className="detail-grid" aria-label="Opportunity workspace"><div className="detail-main">
      <section className="tracker-panel"><header className="tracker-panel__header"><h2 className="tracker-panel__title">Activity history</h2><span className="tracker-panel__meta">{detail.activities.length}</span></header><OpportunityActivityTimeline activities={detail.activities} /></section>
      {detail.type === "job" ? <section className="tracker-panel"><header className="tracker-panel__header"><h2 className="tracker-panel__title">Application materials</h2><span className="tracker-panel__meta">{detail.artifacts.length}</span></header><OpportunityArtifactViewer opportunityId={detail.id} artifacts={detail.artifacts} /></section> : null}
    </div><aside className="detail-side"><section className="next-action-card"><header className="tracker-panel__header"><h2 className="tracker-panel__title">Next actions</h2><span className="tracker-panel__meta">{detail.tasks.length}</span></header><OpportunityTaskList tasks={detail.tasks} pendingTaskId={pendingTaskId} onAction={onTaskAction} /></section><section className="tracker-panel connection-summary"><header className="tracker-panel__header"><h2 className="tracker-panel__title">{detail.type === "connection" ? "Connection snapshot" : "Job snapshot"}</h2></header><dl className="detail-list">{detail.type === "connection" ? <><div><dt>Relationship strength</dt><dd>{detail.relationshipStrength[0].toUpperCase() + detail.relationshipStrength.slice(1)}</dd></div><div><dt>Role or context</dt><dd>{detail.roleContext ?? "Not set"}</dd></div><div><dt>Contact information</dt><dd>{detail.contactInfo ?? "Not set"}</dd></div><div><dt>Met through</dt><dd>{detail.meetingContext ?? "Not set"}</dd></div><div><dt>Last interaction</dt><dd>{detail.lastInteractionAt?.slice(0, 10) ?? "Not set"}</dd></div>{detail.originatedJobs.length ? <div><dt>Originated jobs</dt><dd><ul>{detail.originatedJobs.map((job) => <li key={job.id}><Link href={`/opportunities/${job.id}`}>{job.label}</Link></li>)}</ul></dd></div> : null}</> : <><div><dt>Posting URL</dt><dd>{detail.url ? <a href={detail.url} rel="noreferrer" target="_blank">View posting</a> : "Not set"}</dd></div><div><dt>Source</dt><dd>{detail.source ?? "Not set"}</dd></div><div><dt>Location</dt><dd>{detail.location ?? "Not set"}</dd></div><div><dt>Contact</dt><dd>{detail.contact ?? "Not set"}</dd></div><div><dt>Applied date</dt><dd>{detail.appliedDate ?? "Not set"}</dd></div><div><dt>Summary</dt><dd>{detail.summary ?? "Not set"}</dd></div>{detail.origin ? <div><dt>Originating connection</dt><dd><Link href={`/opportunities/${detail.origin.id}`}>{detail.origin.label}</Link></dd></div> : null}</>}</dl></section></aside></section>
  </>;
}

type DetailSurface = { kind: "interaction" } | { kind: "task" } | { kind: "edit" } | { kind: "linked-job" };
const emptyInteraction = { activityType: "note" as typeof humanActivityTypes[number], body: "", occurredDate: "", taskTitle: "", taskDueDate: "" };
const emptyTask = { title: "", dueDate: "" };

export function OpportunityDetailPage({ opportunityId }: { opportunityId: string }) {
  const router = useRouter(); const [detail, setDetail] = useState<OpportunityDetail | null>(null); const [pageError, setPageError] = useState<string | null>(null); const [dialogError, setDialogError] = useState<string | null>(null); const [status, setStatus] = useState<string | null>(null); const [pendingTaskId, setPendingTaskId] = useState<string | null>(null); const [isSubmitting, setIsSubmitting] = useState(false);
  const [surface, setSurface] = useState<DetailSurface | null>(null);
  const [interaction, setInteraction] = useState(emptyInteraction); const [task, setTask] = useState(emptyTask);
  const mounted = useRef(true); const detailGeneration = useRef(0); const dialogGeneration = useRef(0); const taskGeneration = useRef(0); const statusGeneration = useRef(0); const submitting = useRef(false); const taskSubmitting = useRef(false);
  useEffect(() => () => { mounted.current = false; detailGeneration.current += 1; dialogGeneration.current += 1; taskGeneration.current += 1; statusGeneration.current += 1; }, []);
  useEffect(() => { mounted.current = true; const generation = ++detailGeneration.current; fetch(`/api/opportunities/${opportunityId}`, { cache: "no-store" }).then(async (response) => { if (!response.ok) throw new Error(await readError(response)); return response.json() as Promise<OpportunityDetail>; }).then((next) => { if (mounted.current && generation === detailGeneration.current) setDetail(next); }).catch((caught) => { if (mounted.current && generation === detailGeneration.current) setPageError(caught instanceof Error ? caught.message : "Unable to load opportunity"); }); }, [opportunityId]);
  const mutate = async (url: string, method: string, payload?: unknown) => { const response = await fetch(url, { method, headers: payload === undefined ? undefined : { "Content-Type": "application/json" }, body: payload === undefined ? undefined : JSON.stringify(payload) }); if (!response.ok) throw new Error(await readError(response)); return response.json() as Promise<OpportunityDetail>; };
  const close = useCallback(() => { dialogGeneration.current += 1; submitting.current = false; setIsSubmitting(false); setInteraction(emptyInteraction); setTask(emptyTask); setDialogError(null); setSurface(null); }, []);
  const open = useCallback((next: DetailSurface) => { dialogGeneration.current += 1; submitting.current = false; setIsSubmitting(false); setDialogError(null); setStatus(null); setSurface(next); }, []);
  const applyDialogResult = useCallback((generation: number, next: OpportunityDetail, message: string, onSuccess?: (detail: OpportunityDetail) => void) => { if (mounted.current && generation === dialogGeneration.current) { setDetail(next); setDialogError(null); setSurface(null); setStatus(message); submitting.current = false; setIsSubmitting(false); onSuccess?.(next); } }, []);
  const submitDialog = useCallback(async (request: () => Promise<OpportunityDetail>, message: string, fallback: string, onSuccess?: (detail: OpportunityDetail) => void) => { if (submitting.current) return; submitting.current = true; setIsSubmitting(true); const generation = dialogGeneration.current; setDialogError(null); try { applyDialogResult(generation, await request(), message, onSuccess); } catch (caught) { if (mounted.current && generation === dialogGeneration.current) { setDialogError(caught instanceof Error ? caught.message : fallback); submitting.current = false; setIsSubmitting(false); } } }, [applyDialogResult]);
  const taskAction = async (task: OpportunityTask, action: TaskAction, dueDate?: string | null) => { if (taskSubmitting.current) return; taskSubmitting.current = true; const generation = ++taskGeneration.current; setPendingTaskId(task.id); setPageError(null); try { const next = await mutate(`/api/opportunities/${opportunityId}/tasks/${task.id}`, "PATCH", { action, ...(action === "reschedule" ? { dueDate } : {}) }); if (mounted.current && generation === taskGeneration.current) setDetail((current) => current ? mergeTaskResult(current, next) : current); } catch (caught) { if (mounted.current && generation === taskGeneration.current) setPageError(caught instanceof Error ? caught.message : "Unable to update task"); } finally { if (mounted.current && generation === taskGeneration.current) { taskSubmitting.current = false; setPendingTaskId(null); } } };
  const changeStatus = (nextStatus: OpportunityStatus) => { const generation = ++statusGeneration.current; void mutate(`/api/opportunities/${opportunityId}/status`, "PATCH", { status: nextStatus }).then((next) => { if (mounted.current && generation === statusGeneration.current) { setDetail((current) => current ? mergeStatusResult(current, next) : current); setStatus("Stage updated"); } }).catch((caught) => { if (mounted.current && generation === statusGeneration.current) setPageError(caught instanceof Error ? caught.message : "Unable to update stage"); }); };
  const archive = async () => { try { const next = await mutate(`/api/opportunities/${opportunityId}/status`, "PATCH", { status: "archived" }); setDetail((current) => current ? mergeStatusResult(current, next) : current); } catch (caught) { setPageError(caught instanceof Error ? caught.message : "Unable to archive opportunity"); } };
  const remove = async () => { if (!window.confirm(`Permanently delete ${detail?.label ?? "this opportunity"}? This cannot be undone.`)) return; try { await deleteOpportunityRequest(fetch, `/api/opportunities/${opportunityId}`, router.push); } catch (caught) { setPageError(caught instanceof Error ? caught.message : "Unable to delete opportunity"); } };
  if (pageError && !detail) return <main className="app-shell"><div className="notice notice--error">{pageError}</div><Link href="/">Back to opportunities</Link></main>;
  if (!detail) return <main className="app-shell"><p>Loading opportunity…</p></main>;
  return <main className="app-shell"><OpportunityDetailContent detail={detail} pendingTaskId={pendingTaskId} onTaskAction={taskAction} onStatusChange={changeStatus} onRecordInteraction={(trigger) => { trigger.focus(); open({ kind: "interaction" }); }} onAddTask={(trigger) => { trigger.focus(); open({ kind: "task" }); }} onEdit={() => open({ kind: "edit" })} onArchive={() => void archive()} onDelete={() => void remove()} onCreateJob={() => open({ kind: "linked-job" })} />
    {pageError ? <div className="notice notice--error" role="alert">{pageError}</div> : null}{status ? <p role="status">{status}</p> : null}
    {surface?.kind === "interaction" ? <Modal title="Record interaction" onClose={close}>{dialogError ? <p role="alert">{dialogError}</p> : null}<InteractionComposer {...interaction} isSubmitting={isSubmitting} onActivityTypeChange={(activityType) => setInteraction((current) => ({ ...current, activityType }))} onBodyChange={(body) => setInteraction((current) => ({ ...current, body }))} onOccurredDateChange={(occurredDate) => setInteraction((current) => ({ ...current, occurredDate }))} onTaskTitleChange={(taskTitle) => setInteraction((current) => ({ ...current, taskTitle }))} onTaskDueDateChange={(taskDueDate) => setInteraction((current) => ({ ...current, taskDueDate }))} onCancel={close} onSubmit={(event) => { event.preventDefault(); void submitDialog(() => mutate(`/api/opportunities/${opportunityId}/activities`, "POST", { type: interaction.activityType, body: interaction.body, occurredAt: interaction.occurredDate ? `${interaction.occurredDate}T12:00:00.000Z` : null, task: interaction.taskTitle ? { title: interaction.taskTitle, dueDate: interaction.taskDueDate || null } : null }), "Interaction recorded", "Unable to save interaction"); }} /></Modal> : null}
    {surface?.kind === "task" ? <Modal title="Add task" onClose={close}>{dialogError ? <p role="alert">{dialogError}</p> : null}<TaskComposer taskTitle={task.title} taskDueDate={task.dueDate} isSubmitting={isSubmitting} onTaskTitleChange={(title) => setTask((current) => ({ ...current, title }))} onTaskDueDateChange={(dueDate) => setTask((current) => ({ ...current, dueDate }))} onCancel={close} onSubmit={(event) => { event.preventDefault(); void submitDialog(() => mutate(`/api/opportunities/${opportunityId}/tasks`, "POST", { title: task.title, dueDate: task.dueDate || null }), "Task added", "Unable to add task"); }} /></Modal> : null}
    {surface?.kind === "edit" ? <Modal size="wide" title="Edit details" onClose={close}>{dialogError ? <p role="alert">{dialogError}</p> : null}{detail.type === "job" ? <JobOpportunityForm initialValue={detail} isSubmitting={isSubmitting} mode="edit" submitLabel="Save details" onCancel={close} onSubmit={(payload) => submitDialog(() => mutate(`/api/opportunities/${opportunityId}`, "PUT", payload.opportunity), "Details saved", "Unable to save details")} /> : <ConnectionOpportunityForm initialValue={detail} isSubmitting={isSubmitting} mode="edit" submitLabel="Save details" onCancel={close} onSubmit={(payload) => submitDialog(() => mutate(`/api/opportunities/${opportunityId}`, "PUT", payload.opportunity), "Details saved", "Unable to save details")} />}</Modal> : null}
    {surface?.kind === "linked-job" && detail.type === "connection" ? <Modal size="wide" title={`Create job from ${detail.label}`} onClose={close}>{dialogError ? <p role="alert">{dialogError}</p> : null}<JobOpportunityForm initialValue={{ type: "job", label: "", organization: detail.organization, status: "wishlist", priority: detail.priority, summary: null, url: null, source: "Connection", location: null, contact: `${detail.label}${detail.roleContext ? ` - ${detail.roleContext}` : ""}`, appliedDate: null, originOpportunityId: detail.id }} originOpportunityId={detail.id} isSubmitting={isSubmitting} mode="linked" submitLabel="Create linked job" onCancel={close} onSubmit={(payload) => void submitDialog(() => mutate(`/api/opportunities/${detail.id}/jobs`, "POST", payload.opportunity), "Linked job created", "Unable to create linked job", (created) => router.push(`/opportunities/${created.id}`))} /></Modal> : null}
  </main>;
}
