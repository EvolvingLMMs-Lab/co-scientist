-- Migration 00006: Dispute Arbitration + Publisher Reputation + Code Auto-Verification
-- Phase B of the bounty marketplace quality assurance layer.

-- ============================================================
-- 1. Publisher Reputation
-- ============================================================

CREATE TABLE IF NOT EXISTS publisher_reputation (
  publisher_id TEXT PRIMARY KEY,
  score REAL NOT NULL DEFAULT 60,
  confidence REAL NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'good'
    CHECK (tier IN ('excellent', 'good', 'fair', 'poor', 'untrusted')),
  -- Raw signals (rolling 90-day window)
  bounties_posted INTEGER NOT NULL DEFAULT 0,
  bounties_awarded INTEGER NOT NULL DEFAULT 0,
  bounties_expired INTEGER NOT NULL DEFAULT 0,
  total_rejections INTEGER NOT NULL DEFAULT 0,
  disputes_received INTEGER NOT NULL DEFAULT 0,
  disputes_lost INTEGER NOT NULL DEFAULT 0,
  reviews_on_time INTEGER NOT NULL DEFAULT 0,
  average_review_hours REAL,
  total_credits_escrowed INTEGER NOT NULL DEFAULT 0,
  total_credits_paid_out INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT)
);

-- ============================================================
-- 2. Disputes
-- ============================================================

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES bounty_submissions(id) ON DELETE CASCADE,
  bounty_id TEXT NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  publisher_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'filed'
    CHECK (status IN (
      'filed', 'responded', 'under_review',
      'resolved_agent_full', 'resolved_split', 'resolved_publisher',
      'withdrawn', 'expired'
    )),
  grounds TEXT[] NOT NULL,
  agent_statement TEXT NOT NULL,
  publisher_response TEXT,
  -- Settlement
  resolution_amount INTEGER,
  resolution_split_bps INTEGER,
  resolution_notes TEXT,
  resolved_by TEXT,
  -- Timestamps
  filed_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT),
  publisher_deadline BIGINT NOT NULL,
  resolution_deadline BIGINT,
  responded_at BIGINT,
  resolved_at BIGINT,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT),
  -- One dispute per submission
  UNIQUE(submission_id)
);

CREATE INDEX IF NOT EXISTS idx_disputes_bounty ON disputes(bounty_id);
CREATE INDEX IF NOT EXISTS idx_disputes_agent ON disputes(agent_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status)
  WHERE status IN ('filed', 'responded', 'under_review');

-- ============================================================
-- 3. Dispute Evidence
-- ============================================================

CREATE TABLE IF NOT EXISTS dispute_evidence (
  id TEXT PRIMARY KEY,
  dispute_id TEXT NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  submitted_by TEXT NOT NULL,
  party TEXT NOT NULL CHECK (party IN ('agent', 'publisher', 'admin')),
  artifact_type TEXT NOT NULL
    CHECK (artifact_type IN ('text', 'url', 'github_commit', 'verification_result', 'criterion_response')),
  content TEXT NOT NULL,
  criterion_index INTEGER,
  submitted_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT)
);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_dispute ON dispute_evidence(dispute_id);

-- ============================================================
-- 4. Extend bounty_submissions for rejection tracking + verification
-- ============================================================

ALTER TABLE bounty_submissions ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE bounty_submissions ADD COLUMN IF NOT EXISTS dispute_deadline_at BIGINT;
ALTER TABLE bounty_submissions ADD COLUMN IF NOT EXISTS source_code TEXT;
ALTER TABLE bounty_submissions ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'none';
ALTER TABLE bounty_submissions ADD COLUMN IF NOT EXISTS verification_results JSONB;
ALTER TABLE bounty_submissions ADD COLUMN IF NOT EXISTS verified_at BIGINT;

-- Add CHECK constraint for verification_status via a domain or trigger
-- (Postgres ALTER TABLE ADD CONSTRAINT on existing column with data requires care)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bounty_submissions_verification_status_check'
  ) THEN
    ALTER TABLE bounty_submissions ADD CONSTRAINT bounty_submissions_verification_status_check
      CHECK (verification_status IN ('none', 'queued', 'running', 'passed', 'failed', 'error'));
  END IF;
END $$;

-- ============================================================
-- 5. Extend bounties for code verification
-- ============================================================

ALTER TABLE bounties ADD COLUMN IF NOT EXISTS test_cases JSONB DEFAULT '[]';
ALTER TABLE bounties ADD COLUMN IF NOT EXISTS code_language TEXT;
ALTER TABLE bounties ADD COLUMN IF NOT EXISTS time_limit_ms INTEGER DEFAULT 3000;
ALTER TABLE bounties ADD COLUMN IF NOT EXISTS memory_limit_kb INTEGER DEFAULT 131072;

-- ============================================================
-- 6. Extend transactions to support dispute payouts
-- ============================================================

-- Drop and recreate the type CHECK to include dispute types.
-- First check if the constraint exists and what it allows.
DO $$
BEGIN
  -- Drop the old constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_type_check'
  ) THEN
    ALTER TABLE transactions DROP CONSTRAINT transactions_type_check;
  END IF;

  -- Add updated constraint with dispute types
  ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
    CHECK (type IN (
      'deposit', 'bounty_escrow', 'bounty_payout', 'bounty_refund',
      'platform_fee', 'withdrawal', 'dispute_payout', 'dispute_refund'
    ));
END $$;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS dispute_id TEXT REFERENCES disputes(id);
