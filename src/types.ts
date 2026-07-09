export const APPLICATION_STATUSES = [
  "wishlist",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "archived"
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_PRIORITIES = ["low", "medium", "high"] as const;

export type ApplicationPriority = (typeof APPLICATION_PRIORITIES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  wishlist: "Wishlist",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  archived: "Archived"
};

export const APPLICATION_NOTE_TYPES = ["update", "internal", "follow_up"] as const;

export type ApplicationNoteType = (typeof APPLICATION_NOTE_TYPES)[number];

export const APPLICATION_ARTIFACT_TYPES = [
  "fit_analysis",
  "outreach_message",
  "referral_message",
  "cover_letter",
  "resume",
  "posting",
  "other"
] as const;

export type ApplicationArtifactType = (typeof APPLICATION_ARTIFACT_TYPES)[number];

export const NOTE_TYPE_LABELS: Record<ApplicationNoteType, string> = {
  update: "Update",
  internal: "Internal note",
  follow_up: "Follow-up"
};

export type Application = {
  id: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  source: string | null;
  location: string | null;
  url: string | null;
  contact: string | null;
  notes: string | null;
  appliedDate: string | null;
  followUpDate: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  priority: ApplicationPriority;
  createdAt: string;
  updatedAt: string;
};

export type ApplicationInput = Omit<Application, "id" | "createdAt" | "updatedAt" | "priority" | "nextAction" | "nextActionDate"> & {
  priority?: ApplicationPriority;
  nextAction?: string | null;
  nextActionDate?: string | null;
};

export type ApplicationNote = {
  id: string;
  applicationId: string;
  type: ApplicationNoteType;
  body: string;
  followUpDate: string | null;
  createdAt: string;
};

export type ApplicationNoteInput = {
  type: ApplicationNoteType;
  body: string;
  followUpDate?: string | null;
};

export type ApplicationStatusChange = {
  id: string;
  applicationId: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  note: string | null;
  createdAt: string;
};

export type ApplicationArtifact = {
  id: string;
  applicationId: string;
  type: ApplicationArtifactType;
  title: string;
  filePath: string;
  contentType: string;
  content: string | null;
  readError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApplicationArtifactInput = {
  type: ApplicationArtifactType;
  title: string;
  filePath: string;
  contentType?: string | null;
};

export type ApplicationActivity =
  | (ApplicationNote & {
      activityType: "note";
    })
  | (ApplicationStatusChange & {
      activityType: "status";
    });

export type FollowUpItem = ApplicationNote & {
  application: Pick<Application, "id" | "company" | "role" | "status" | "source" | "location">;
};

export type ApplicationDetail = Omit<Application, "notes"> & {
  summary: string | null;
  notes: ApplicationNote[];
  statusHistory: ApplicationStatusChange[];
  artifacts: ApplicationArtifact[];
  activity: ApplicationActivity[];
};

export type ApplicationFilters = {
  search?: string;
  status?: ApplicationStatus | "all";
};

export const EMPTY_APPLICATION_INPUT: ApplicationInput = {
  company: "",
  role: "",
  status: "wishlist",
  source: null,
  location: null,
  url: null,
  contact: null,
  notes: null,
  appliedDate: null,
  followUpDate: null,
  nextAction: null,
  nextActionDate: null,
  priority: "medium"
};
