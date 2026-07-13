import type { OpportunityActivity } from "../types";

const USER_LABELS = { note: "Note", meeting: "Meeting", call: "Call", email: "Email", message: "Message", introduction: "Introduction" } as const;

export function OpportunityActivityTimeline({ activities }: { activities: OpportunityActivity[] }) {
  if (!activities.length) return <p className="activity-timeline__empty">No activity has been recorded yet.</p>;
  return <ol className="activity-timeline" aria-label="Opportunity activity history">
    {[...activities].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((activity) => {
      const label = activity.type in USER_LABELS ? USER_LABELS[activity.type as keyof typeof USER_LABELS] : activity.type.split("_").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
      return <li className="activity-timeline__item" key={activity.id}><span className={`activity-timeline__marker activity-timeline__marker--${activity.type}`} /><div><div className="activity-timeline__meta"><strong>{label}</strong><time dateTime={activity.occurredAt}>{new Date(activity.occurredAt).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}</time></div><p>{activity.body}</p></div></li>;
    })}
  </ol>;
}
