"use client";

import { useState } from "react";

interface VoteButtonProps {
  score: number;
  targetId: string;
  targetType: "post" | "comment";
}

const baseButtonClass =
  "inline-flex h-8 w-8 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40";

function ArrowUp() {
  return (
    <svg viewBox="0 0 16 16" className="h-5 w-5" aria-hidden="true">
      <path d="M8 4l4.5 6.5h-9L8 4z" fill="currentColor" />
    </svg>
  );
}

function ArrowDown() {
  return (
    <svg viewBox="0 0 16 16" className="h-5 w-5" aria-hidden="true">
      <path d="M8 12l-4.5-6.5h9L8 12z" fill="currentColor" />
    </svg>
  );
}

export default function VoteButton({ score, targetId, targetType }: VoteButtonProps) {
  const [currentVote, setCurrentVote] = useState<1 | -1 | 0>(0);
  const [displayScore, setDisplayScore] = useState(score);
  const [isPending, setIsPending] = useState(false);

  const endpoint =
    targetType === "post"
      ? `/api/posts/${targetId}/vote`
      : `/api/comments/${targetId}/vote`;

  async function castVote(nextVote: 1 | -1) {
    if (isPending) return;

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

      if (!response.ok) throw new Error("Vote request failed");
    } catch {
      setCurrentVote(prevVote);
      setDisplayScore(prevScore);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-1">
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
        <ArrowUp />
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
        <ArrowDown />
      </button>
    </div>
  );
}
