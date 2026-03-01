"use client";

import { useEffect, useState } from "react";
import type { AcceptanceCriterion, CriterionScore } from "@/types/bounty";

interface SubmissionReviewFormProps {
  bountyId: string;
  submissionId: string;
  acceptanceCriteria: AcceptanceCriterion[];
  onAwarded?: () => void;
}

type CriterionSelection = boolean | number | null;

const scoreOptions = [1, 2, 3, 4, 5] as const;

export function SubmissionReviewForm({
  bountyId,
  submissionId,
  acceptanceCriteria,
  onAwarded,
}: SubmissionReviewFormProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAwarded, setIsAwarded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [criterionSelections, setCriterionSelections] = useState<CriterionSelection[]>(
    acceptanceCriteria.map(() => null),
  );

  useEffect(() => {
    setCriterionSelections(acceptanceCriteria.map(() => null));
  }, [acceptanceCriteria]);

  const setScoredCriterion = (criterionIndex: number, score: number) => {
    setCriterionSelections((previous) => {
      const next = [...previous];
      next[criterionIndex] = score;
      return next;
    });
  };

  const setBinaryCriterion = (criterionIndex: number, pass: boolean) => {
    setCriterionSelections((previous) => {
      const next = [...previous];
      next[criterionIndex] = pass;
      return next;
    });
  };

  const buildCriteriaScores = (): CriterionScore[] => {
    return acceptanceCriteria.flatMap<CriterionScore>((criterion, criterionIndex) => {
      const selection = criterionSelections[criterionIndex];

      if (criterion.type === "binary") {
        if (typeof selection === "boolean") {
          return [{ criterionIndex, pass: selection }];
        }
        return [];
      }

      if (typeof selection === "number") {
        return [{ criterionIndex, score: selection }];
      }

      return [];
    });
  };

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();

    if (qualityScore === null) {
      setErrorMessage("Select a quality score before awarding.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const criteriaScores = buildCriteriaScores();
    const trimmedNotes = reviewNotes.trim();

    try {
      const response = await fetch(`/api/bounties/${bountyId}/award`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          submissionId,
          qualityScore,
          reviewNotes: trimmedNotes.length > 0 ? trimmedNotes : undefined,
          criteriaScores,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setErrorMessage(payload?.error ?? "Failed to award submission.");
        return;
      }

      setIsAwarded(true);
      setIsExpanded(false);
      onAwarded?.();
    } catch {
      setErrorMessage("Failed to award submission.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const scoreButtonClass = (isSelected: boolean): string => {
    const baseClass =
      "inline-flex size-7 items-center justify-center border border-[var(--color-border)] text-xs font-medium transition-colors hover:border-[var(--color-border-hover)]";
    return isSelected
      ? `${baseClass} bg-[var(--color-text-primary)] text-[var(--color-bg-primary)]`
      : `${baseClass} text-[var(--color-text-secondary)]`;
  };

  const actionButtonClass =
    "border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-60";

  const confirmButtonClass =
    "border border-[var(--color-text-primary)] bg-[var(--color-text-primary)] px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-[var(--color-bg-primary)] transition-colors hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-primary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:border-[var(--color-border)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-muted)]";

  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setIsExpanded((previous) => !previous)}
          className={actionButtonClass}
          disabled={isSubmitting || isAwarded}
        >
          {isAwarded ? "Awarded" : "Award This Submission"}
        </button>
        {isAwarded ? (
          <p className="text-sm font-medium text-[var(--color-text-primary)]">Awarded successfully.</p>
        ) : null}
      </div>

      {isExpanded ? (
        <form onSubmit={handleSubmit} className="mt-4 border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                Quality Score
              </p>
              <div className="flex items-center gap-2">
                {scoreOptions.map((score) => (
                  <button
                    key={score}
                    type="button"
                    className={scoreButtonClass(qualityScore === score)}
                    onClick={() => setQualityScore(score)}
                    aria-pressed={qualityScore === score}
                  >
                    {score}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor={`review-notes-${submissionId}`}
                className="mb-2 block text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]"
              >
                Review Notes
              </label>
              <textarea
                id={`review-notes-${submissionId}`}
                value={reviewNotes}
                onChange={(event) => setReviewNotes(event.target.value)}
                placeholder="Explain why this submission is the best..."
                rows={4}
                className="w-full border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm font-light text-[var(--color-text-secondary)] focus:border-[var(--color-border-hover)] focus:outline-none"
              />
            </div>

            {acceptanceCriteria.length > 0 ? (
              <div className="space-y-3 border-t border-[var(--color-border)] pt-3">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  Acceptance Criteria Review
                </p>
                {acceptanceCriteria.map((criterion, criterionIndex) => (
                  <div key={`${criterion.criterion}-${criterionIndex}`} className="border border-[var(--color-border)] p-3">
                    <p className="mb-2 text-sm font-light text-[var(--color-text-secondary)]">{criterion.criterion}</p>

                    {criterion.type === "binary" ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className={scoreButtonClass(criterionSelections[criterionIndex] === true)}
                          onClick={() => setBinaryCriterion(criterionIndex, true)}
                          aria-pressed={criterionSelections[criterionIndex] === true}
                        >
                          Pass
                        </button>
                        <button
                          type="button"
                          className={scoreButtonClass(criterionSelections[criterionIndex] === false)}
                          onClick={() => setBinaryCriterion(criterionIndex, false)}
                          aria-pressed={criterionSelections[criterionIndex] === false}
                        >
                          Fail
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {scoreOptions.map((score) => (
                          <button
                            key={score}
                            type="button"
                            className={scoreButtonClass(criterionSelections[criterionIndex] === score)}
                            onClick={() => setScoredCriterion(criterionIndex, score)}
                            aria-pressed={criterionSelections[criterionIndex] === score}
                          >
                            {score}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            {errorMessage ? (
              <p className="text-sm font-light text-[var(--color-text-secondary)]">{errorMessage}</p>
            ) : null}

            <div>
              <button type="submit" className={confirmButtonClass} disabled={isSubmitting}>
                {isSubmitting ? "Confirming Award..." : "Confirm Award"}
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}
