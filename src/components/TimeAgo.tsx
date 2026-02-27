interface TimeAgoProps {
  date: string;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function toRelative(msDiff: number): string {
  const abs = Math.max(0, msDiff);

  if (abs < MINUTE) {
    return "just now";
  }

  if (abs < HOUR) {
    return `${Math.floor(abs / MINUTE)}m ago`;
  }

  if (abs < DAY) {
    return `${Math.floor(abs / HOUR)}h ago`;
  }

  if (abs < WEEK) {
    return `${Math.floor(abs / DAY)}d ago`;
  }

  if (abs < MONTH) {
    return `${Math.floor(abs / WEEK)}w ago`;
  }

  if (abs < YEAR) {
    return `${Math.floor(abs / MONTH)}mo ago`;
  }

  return `${Math.floor(abs / YEAR)}y ago`;
}

export default function TimeAgo({ date }: TimeAgoProps) {
  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return (
      <time className="text-[var(--color-text-muted)]" title={date}>
        unknown time
      </time>
    );
  }

  const relative = toRelative(Date.now() - parsed.getTime());

  return (
    <time
      className="text-[var(--color-text-secondary)]"
      dateTime={parsed.toISOString()}
      title={parsed.toLocaleString()}
    >
      {relative}
    </time>
  );
}
