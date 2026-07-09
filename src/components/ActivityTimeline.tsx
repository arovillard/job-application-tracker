"use client";

import {
  NOTE_TYPE_LABELS,
  STATUS_LABELS,
  type ApplicationActivity
} from "../types";

type ActivityTimelineProps = {
  activity: ApplicationActivity[];
};

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short"
});

function formatDateTime(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return DATE_TIME_FORMAT.format(parsed);
}

export function ActivityTimeline({ activity }: ActivityTimelineProps) {
  if (activity.length === 0) {
    return (
      <div className="activity-timeline__empty">
        No notes or status changes have been recorded yet.
      </div>
    );
  }

  return (
    <ol className="activity-timeline" aria-label="Application activity history">
      {activity.map((item) => {
        if (item.activityType === "note") {
          return (
            <li className="activity-timeline__item" key={`note-${item.id}`}>
              <div className="activity-timeline__marker activity-timeline__marker--note" />
              <div className="activity-timeline__content">
                <div className="activity-timeline__meta">
                  <span className="activity-timeline__type">{NOTE_TYPE_LABELS[item.type]}</span>
                  <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                  {item.followUpDate ? (
                    <span className="activity-timeline__date">Due {item.followUpDate}</span>
                  ) : null}
                </div>
                <p className="activity-timeline__body">{item.body}</p>
              </div>
            </li>
          );
        }

        return (
          <li className="activity-timeline__item" key={`status-${item.id}`}>
            <div className="activity-timeline__marker activity-timeline__marker--status" />
            <div className="activity-timeline__content">
              <div className="activity-timeline__meta">
                <span className="activity-timeline__type">Status</span>
                <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
              </div>
              <p className="activity-timeline__body">
                {item.fromStatus
                  ? `${STATUS_LABELS[item.fromStatus]} -> ${STATUS_LABELS[item.toStatus]}`
                  : `Started as ${STATUS_LABELS[item.toStatus]}`}
              </p>
              {item.note ? <p className="activity-timeline__note">{item.note}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
