"use client";

import { useState } from "react";

interface VoteButtonProps {
  score: number;
  targetId: string;
  targetType: "post" | "comment";
}

type ApiErrorPayload = {
  error?: string;
};

const baseButtonClass =
  "inline-flex h-9 w-9 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40";

function readErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const maybeError = (payload as ApiErrorPayload).error;
  if (typeof maybeError === "string" && maybeError.trim()) {
    return maybeError;
  }

  return fallback;
}

function ChevronUp() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
      <polyline
        points="3 10.5 8 5.5 13 10.5"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
      <polyline
        points="3 5.5 8 10.5 13 5.5"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export default function VoteButton({ score, targetId, targetType }: VoteButtonProps) {
  const [currentVote, setCurrentVote] = useState<1 | -1 | 0>(0);
  const [displayScore, setDisplayScore] = useState(score);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoint =
    targetType === "post"
      ? `/api/posts/${targetId}/vote`
      : `/api/comments/${targetId}/vote`;

  async function castVote(nextVote: 1 | -1) {
    if (isPending) return;

    setError(null);

    const prevVote = currentVote;
    const prevScore = displayScore;
    const scoreDelta = nextVote - prevVote;

    setIsPending(true);
    setCurrentVote(nextVote);
    setDisplayScore((current) => current + scoreDelta);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: nextVote }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
        throw new Error(readErrorMessage(payload, "Vote request failed."));
      }
    } catch (voteError) {
      setCurrentVote(prevVote);
      setDisplayScore(prevScore);
      setError(voteError instanceof Error ? voteError.message : "Vote request failed.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        aria-label="Upvote"
        className={`${baseButtonClass} ${
          currentVote === 1
            ? "text-[var(--color-text-primary)]"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
        }`}
        onClick={() => castVote(1)}
        disabled={isPending}
      >
        <ChevronUp />
      </button>

      <span
        className="min-w-6 text-center text-sm font-bold tabular-nums leading-none text-[var(--color-text-primary)]"
        aria-live="polite"
      >
        {displayScore}
      </span>

      <button
        type="button"
        aria-label="Downvote"
        className={`${baseButtonClass} ${
          currentVote === -1
            ? "text-[var(--color-text-primary)]"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
        }`}
        onClick={() => castVote(-1)}
        disabled={isPending}
      >
        <ChevronDown />
      </button>

      {error ? (
        <p
          className="mt-1 max-w-28 text-center text-[10px] font-light leading-tight text-[var(--color-text-muted)]"
          role="status"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
