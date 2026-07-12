import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetStorageForTests } from "../../../lib/storage";
import { GET as listOpportunities, POST as createOpportunity } from "./route";
import {
  DELETE as deleteOpportunity,
  GET as getOpportunity,
  PUT as updateOpportunity
} from "./[id]/route";
import { PATCH as changeStatus } from "./[id]/status/route";
import { POST as addActivity } from "./[id]/activities/route";
import { POST as addTask } from "./[id]/tasks/route";
import { PATCH as updateTask } from "./[id]/tasks/[taskId]/route";
import { POST as createLinkedJob } from "./[id]/jobs/route";
import type { ConnectionOpportunityInput, JobOpportunityInput, OpportunityDetail } from "../../../types";

const connectionInput: ConnectionOpportunityInput = {
  type: "connection",
  label: "Maya Chen",
  organization: "Acme",
  status: "new",
  priority: "medium",
  summary: "Met at a platform leadership meetup",
  roleContext: "VP Engineering",
  contactInfo: "maya@example.com",
  meetingContext: "Example City engineering meetup",
  relationshipStrength: "familiar"
};

const jobInput: JobOpportunityInput = {
  type: "job",
  label: "Engineering Manager",
  organization: "Acme",
  status: "wishlist",
  priority: "high",
  summary: "Platform leadership role",
  url: "https://example.com/job",
  source: "Acme careers",
  location: "Example City",
  contact: "Maya Chen",
  appliedDate: null,
  originOpportunityId: null
};

let directory: string;

function request(url: string, method = "GET", body?: unknown) {
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function taskContext(id: string, taskId: string) {
  return { params: Promise.resolve({ id, taskId }) };
}

async function json<T>(response: Response) {
  return (await response.json()) as T;
}

async function create(input: ConnectionOpportunityInput | JobOpportunityInput) {
  const response = await createOpportunity(request("http://localhost/api/opportunities", "POST", {
    opportunity: input
  }));
  expect(response.status).toBe(201);
  return json<OpportunityDetail>(response);
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "jobtracker-api-"));
  process.env.JOBTRACKER_DB_PATH = path.join(directory, "jobtracker.sqlite");
  resetStorageForTests();
});

afterEach(() => {
  resetStorageForTests();
  delete process.env.JOBTRACKER_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("opportunity API", () => {
  it("creates transactionally and lists by type, status, search, and archive visibility", async () => {
    const response = await createOpportunity(request("http://localhost/api/opportunities", "POST", {
      opportunity: connectionInput,
      initialActivity: {
        type: "meeting",
        body: "Discussed platform leadership",
        occurredAt: "2026-07-10T18:00:00.000Z"
      },
      initialTask: { title: "Send portfolio", dueDate: "2026-07-15" }
    }));
    expect(response.status).toBe(201);
    const created = await json<OpportunityDetail>(response);
    expect(created.activities.map((activity) => activity.type)).toContain("meeting");
    expect(created.tasks).toEqual([
      expect.objectContaining({ title: "Send portfolio", dueDate: "2026-07-15", state: "open" })
    ]);

    const job = await create(jobInput);
    await changeStatus(request("http://localhost/status", "PATCH", { status: "archived" }), context(job.id));

    const connections = await json<OpportunityDetail[]>(await listOpportunities(
      request("http://localhost/api/opportunities?type=connection&status=new&search=maya")
    ));
    expect(connections.map((item) => item.id)).toEqual([created.id]);

    const archived = await json<OpportunityDetail[]>(await listOpportunities(
      request("http://localhost/api/opportunities?archived=only")
    ));
    expect(archived.map((item) => item.id)).toEqual([job.id]);
  });

  it("gets, updates, deletes, and reports missing opportunities", async () => {
    const created = await create(connectionInput);
    const loaded = await getOpportunity(request("http://localhost/detail"), context(created.id));
    expect(loaded.status).toBe(200);

    const updated = await updateOpportunity(request("http://localhost/detail", "PUT", {
      ...connectionInput,
      status: "in_conversation",
      relationshipStrength: "strong"
    }), context(created.id));
    expect(await json<OpportunityDetail>(updated)).toMatchObject({
      status: "in_conversation",
      relationshipStrength: "strong"
    });

    expect((await deleteOpportunity(request("http://localhost/detail", "DELETE"), context(created.id))).status).toBe(200);
    expect((await getOpportunity(request("http://localhost/detail"), context(created.id))).status).toBe(404);
  });

  it("validates type-specific statuses and records activities with optional tasks", async () => {
    const created = await create(connectionInput);
    const invalid = await changeStatus(
      request("http://localhost/status", "PATCH", { status: "interviewing" }),
      context(created.id)
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Status is invalid for a connection opportunity" });

    const activityResponse = await addActivity(request("http://localhost/activities", "POST", {
      type: "message",
      body: "Sent the requested portfolio",
      occurredAt: "2026-07-11T17:00:00.000Z",
      task: { title: "Check for a reply", dueDate: "2026-07-18" }
    }), context(created.id));
    const detail = await json<OpportunityDetail>(activityResponse);
    expect(detail.activities.map((activity) => activity.type)).toContain("message");
    expect(detail.tasks[0]).toMatchObject({ title: "Check for a reply", sourceActivityId: expect.any(String) });
  });

  it("creates and updates tasks while rejecting cross-opportunity task IDs", async () => {
    const first = await create(connectionInput);
    const second = await create({ ...connectionInput, label: "Jordan Lee" });
    const taskResponse = await addTask(
      request("http://localhost/tasks", "POST", { title: "Send introduction", dueDate: "2026-07-20" }),
      context(first.id)
    );
    const task = (await json<OpportunityDetail>(taskResponse)).tasks[0]!;

    const completed = await updateTask(
      request("http://localhost/task", "PATCH", { action: "complete" }),
      taskContext(first.id, task.id)
    );
    expect((await json<OpportunityDetail>(completed)).tasks[0]).toMatchObject({ state: "completed" });

    const reopened = await updateTask(
      request("http://localhost/task", "PATCH", { action: "reopen" }),
      taskContext(first.id, task.id)
    );
    expect((await json<OpportunityDetail>(reopened)).tasks[0]).toMatchObject({
      state: "open",
      completedAt: null
    });

    const wrongOwner = await updateTask(
      request("http://localhost/task", "PATCH", { action: "reschedule", dueDate: "2026-07-22" }),
      taskContext(second.id, task.id)
    );
    expect(wrongOwner.status).toBe(400);
  });

  it("creates linked jobs only from active connections", async () => {
    const connection = await create(connectionInput);
    const linkedResponse = await createLinkedJob(
      request("http://localhost/jobs", "POST", jobInput),
      context(connection.id)
    );
    expect(await json<OpportunityDetail>(linkedResponse)).toMatchObject({
      type: "job",
      originOpportunityId: connection.id
    });

    const job = await create(jobInput);
    expect((await createLinkedJob(request("http://localhost/jobs", "POST", jobInput), context(job.id))).status).toBe(400);

    const archivedConnection = await create({ ...connectionInput, label: "Archived Person" });
    await changeStatus(
      request("http://localhost/status", "PATCH", { status: "archived" }),
      context(archivedConnection.id)
    );
    expect((await createLinkedJob(
      request("http://localhost/jobs", "POST", jobInput),
      context(archivedConnection.id)
    )).status).toBe(400);
  });
});
