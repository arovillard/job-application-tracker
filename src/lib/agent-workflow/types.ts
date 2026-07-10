export const AGENT_RUN_STATES = [
  "queued_preview",
  "previewing",
  "awaiting_approval",
  "queued_execution",
  "executing",
  "verifying",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted"
] as const;

export type AgentRunState = (typeof AGENT_RUN_STATES)[number];

export type AgentProviderName = "codex" | "claude";

export type AgentPreview = {
  company: string;
  role: string;
  location: string | null;
  summary: string;
  postingState: "open" | "closed" | "unknown";
};

export type ArtifactManifestEntry = {
  type:
    | "fit_analysis"
    | "outreach_message"
    | "referral_message"
    | "cover_letter"
    | "resume"
    | "posting"
    | "other";
  title: string;
  filePath: string;
  contentType: string;
};

export type AgentArtifactLink = {
  id: string;
  type: ArtifactManifestEntry["type"];
  title: string;
  href: string;
};

export type AgentUsage = Record<string, number>;

export type AgentRunEventKind = "status" | "progress" | "warning" | "usage" | "error";

export type AgentEventMetadataValue = string | number | boolean | null;

export type AgentRunEvent = {
  id: string;
  runId: string;
  sequence: number;
  kind: AgentRunEventKind;
  message: string;
  metadata: Record<string, AgentEventMetadataValue> | null;
  createdAt: string;
};

export type AgentRun = {
  id: string;
  provider: AgentProviderName;
  model: string;
  canonicalJobUrl: string;
  state: AgentRunState;
  preview: AgentPreview | null;
  applicationId: string | null;
  artifactManifest: ArtifactManifestEntry[] | null;
  artifactLinks: AgentArtifactLink[];
  usage: AgentUsage | null;
  cancellationRequested: boolean;
  workerId: string | null;
  leaseExpiresAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicAgentRun = Omit<
  AgentRun,
  "workerId" | "leaseExpiresAt" | "artifactManifest"
> & {
  events: AgentRunEvent[];
};
