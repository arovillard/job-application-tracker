import type { OpportunitySummary } from "../types";

const TERMINAL_STATUSES = new Set(["archived", "rejected", "dormant", "closed"]);

export function PipelinePulse({ opportunities, attentionCount }: {
  opportunities: OpportunitySummary[];
  attentionCount: number;
}) {
  const activeOpportunities = opportunities.filter(({ status }) => !TERMINAL_STATUSES.has(status));
  const activeJobs = activeOpportunities.filter(({ type }) => type === "job").length;
  const activeConnections = activeOpportunities.length - activeJobs;
  const closedOrArchived = opportunities.length - activeOpportunities.length;
  const jobWidth = activeOpportunities.length === 0 ? 0 : (activeJobs / activeOpportunities.length) * 100;
  const connectionWidth = activeOpportunities.length === 0 ? 0 : (activeConnections / activeOpportunities.length) * 100;

  return <section className="pipeline-pulse" aria-labelledby="pipeline-pulse-heading">
    <h2 id="pipeline-pulse-heading">Pipeline pulse</h2>
    <div className="pipeline-pulse__metrics">
      <p><strong>{activeOpportunities.length}</strong> Active</p>
      <p><strong>{activeJobs}</strong> Jobs</p>
      <p><strong>{activeConnections}</strong> Connections</p>
      <p><strong>{attentionCount}</strong> Needs attention</p>
      <p><strong>{closedOrArchived}</strong> Closed / archived</p>
    </div>
    <div
      className={activeOpportunities.length === 0 ? "pipeline-pulse__bar pipeline-pulse__bar--empty" : "pipeline-pulse__bar"}
      aria-hidden="true"
    >
      {activeOpportunities.length > 0 ? <>
        <span className="pipeline-pulse__bar-jobs" style={{ width: `${jobWidth}%` }} />
        <span className="pipeline-pulse__bar-connections" style={{ width: `${connectionWidth}%` }} />
      </> : null}
    </div>
  </section>;
}
