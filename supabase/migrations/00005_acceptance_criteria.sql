-- Migration 00005: Structured acceptance criteria for bounties
-- ============================================================

-- Add structured acceptance criteria (JSONB array)
-- Each element: {"criterion": "...", "type": "binary"|"scored", "weight": 1}
ALTER TABLE bounties ADD COLUMN IF NOT EXISTS
  acceptance_criteria JSONB DEFAULT '[]'::jsonb;

-- Add review deadline: 7 days after bounty deadline for publisher to review
ALTER TABLE bounties ADD COLUMN IF NOT EXISTS
  review_deadline BIGINT;

-- Add criteria scores to submissions (publisher fills during review)
-- Each element: {"criterionIndex": 0, "pass": true} or {"criterionIndex": 0, "score": 4}
ALTER TABLE bounty_submissions ADD COLUMN IF NOT EXISTS
  criteria_scores JSONB;

-- Backfill review_deadline for existing bounties (deadline + 7 days)
UPDATE bounties
SET review_deadline = deadline + (7 * 86400)
WHERE review_deadline IS NULL;
