-- Co-Scientist Bounty Marketplace Schema
-- Migration 3: Bounty system tables

-- ============================================================
-- Bounties
-- ============================================================
CREATE TABLE IF NOT EXISTS bounties (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  panel_id TEXT REFERENCES panels(id) ON DELETE SET NULL,
  creator_user_id TEXT NOT NULL,
  reward_amount INTEGER NOT NULL CHECK (reward_amount > 0),
  escrow_tx_id TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'awarded', 'expired', 'cancelled', 'disputed')),
  awarded_submission_id TEXT,
  deadline BIGINT NOT NULL,
  max_submissions INTEGER NOT NULL DEFAULT 10,
  difficulty_tier TEXT NOT NULL DEFAULT 'moderate'
    CHECK (difficulty_tier IN ('trivial', 'moderate', 'hard', 'research')),
  evaluation_criteria TEXT,
  tags TEXT,
  submission_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT),
  updated_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
CREATE INDEX IF NOT EXISTS idx_bounties_creator ON bounties(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_bounties_panel ON bounties(panel_id);
CREATE INDEX IF NOT EXISTS idx_bounties_deadline ON bounties(deadline);

-- ============================================================
-- Bounty Submissions
-- ============================================================
CREATE TABLE IF NOT EXISTS bounty_submissions (
  id TEXT PRIMARY KEY,
  bounty_id TEXT NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  approach_summary TEXT,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'accepted', 'rejected')),
  quality_score INTEGER,
  review_notes TEXT,
  submitted_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT),
  reviewed_at BIGINT,
  UNIQUE(bounty_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_bounty ON bounty_submissions(bounty_id);
CREATE INDEX IF NOT EXISTS idx_submissions_agent ON bounty_submissions(agent_id);

-- ============================================================
-- Transactions (immutable financial ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  agent_id TEXT,
  bounty_id TEXT REFERENCES bounties(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'deposit', 'bounty_escrow', 'bounty_payout',
    'bounty_refund', 'platform_fee', 'withdrawal'
  )),
  idempotency_key TEXT UNIQUE,
  description TEXT,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT)
);

CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_agent ON transactions(agent_id);
CREATE INDEX IF NOT EXISTS idx_tx_bounty ON transactions(bounty_id);

-- ============================================================
-- User Wallets (cached balance projection)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_wallets (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT)
);

-- ============================================================
-- Agent Wallets
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_wallets (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_submitted INTEGER NOT NULL DEFAULT 0,
  average_quality REAL,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT)
);

-- ============================================================
-- RLS: Disable (application layer enforces auth)
-- ============================================================
ALTER TABLE bounties DISABLE ROW LEVEL SECURITY;
ALTER TABLE bounty_submissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_wallets DISABLE ROW LEVEL SECURITY;
ALTER TABLE agent_wallets DISABLE ROW LEVEL SECURITY;
