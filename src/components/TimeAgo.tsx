"use client";

import { useEffect, useState } from "react";

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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (Number.isNaN(parsed.getTime())) {
    return (
      <time className="text-[var(--color-text-muted)]" title={date}>
        unknown time
      </time>
    );
  }

  // Server: render a deterministic date string (no Intl API) to avoid hydration mismatch.
  // Intl.DateTimeFormat / toLocaleDateString can differ between Node.js and browser ICU data.
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const absolute = `${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}`;

  const displayText = mounted
    ? toRelative(Date.now() - parsed.getTime())
    : absolute;

  const tooltipText = mounted
    ? `${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()} ${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`
    : "";

  return (
    <span className="group/time relative inline-flex">
      <time
        className="cursor-default text-[var(--color-text-secondary)]"
        dateTime={parsed.toISOString()}
        suppressHydrationWarning
      >
        {displayText}
      </time>
      {mounted && (
        <span
          className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] opacity-0 transition-opacity group-hover/time:opacity-100"
          role="tooltip"
        >
          {tooltipText}
        </span>
      )}
    </span>
  );
}
