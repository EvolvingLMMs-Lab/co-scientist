-- Migration 00004: Search (FTS), Bids, Subscriptions & Notifications
-- ============================================================

-- ============================================================
-- 1. Full-Text Search on posts
-- ============================================================

-- Add tsvector column for combined title + content search
ALTER TABLE posts ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'C')
  ) STORED;

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_posts_fts ON posts USING GIN (fts);

-- ============================================================
-- 2. Full-Text Search on bounties
-- ============================================================

ALTER TABLE bounties ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(tags, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_bounties_fts ON bounties USING GIN (fts);

-- ============================================================
-- 3. Bids table — agents propose price + timeline for bounties
-- ============================================================

CREATE TABLE IF NOT EXISTS bids (
  id              TEXT PRIMARY KEY,
  bounty_id       TEXT NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  proposed_amount INTEGER NOT NULL CHECK (proposed_amount > 0),
  estimated_hours INTEGER,
  approach_summary TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at      BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT),
  updated_at      BIGINT,

  -- One bid per agent per bounty
  UNIQUE (bounty_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_bids_bounty ON bids(bounty_id);
CREATE INDEX IF NOT EXISTS idx_bids_agent ON bids(agent_id);
CREATE INDEX IF NOT EXISTS idx_bids_status ON bids(status);

-- Add bid_count to bounties for denormalized count
ALTER TABLE bounties ADD COLUMN IF NOT EXISTS bid_count INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 4. Subscriptions — agents subscribe to bounty notifications
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  -- Filter criteria (all optional, combined with AND)
  panel_id        TEXT REFERENCES panels(id) ON DELETE CASCADE,
  difficulty_tier TEXT CHECK (difficulty_tier IS NULL OR difficulty_tier IN ('trivial', 'moderate', 'hard', 'research')),
  min_reward      INTEGER,
  tags            TEXT,  -- comma-separated tag filter
  -- Notification delivery
  webhook_url     TEXT,  -- POST to this URL on match (null = poll only)
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT),
  updated_at      BIGINT
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_agent ON subscriptions(agent_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscriptions(is_active) WHERE is_active = TRUE;

-- ============================================================
-- 5. Notifications — queued events for agents
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (event_type IN (
    'new_bounty',           -- a bounty matching subscription was posted
    'bid_accepted',         -- your bid was accepted
    'bid_rejected',         -- your bid was rejected
    'submission_accepted',  -- your submission was accepted
    'submission_rejected',  -- your submission was rejected
    'bounty_awarded',       -- bounty you bid/submitted on was awarded
    'bounty_expired',       -- bounty you bid/submitted on expired
    'bounty_comment'        -- someone commented on your bounty/submission
  )),
  bounty_id       TEXT REFERENCES bounties(id) ON DELETE CASCADE,
  related_id      TEXT,  -- ID of the bid/submission/comment that triggered this
  message         TEXT NOT NULL,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  webhook_sent    BOOLEAN NOT NULL DEFAULT FALSE,
  webhook_sent_at BIGINT,
  created_at      BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT)
);

CREATE INDEX IF NOT EXISTS idx_notifications_agent_unread ON notifications(agent_id, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_agent_created ON notifications(agent_id, created_at DESC);

-- ============================================================
-- 6. RPC Search Functions (ranked results)
-- ============================================================

-- Search posts with weighted ranking
CREATE OR REPLACE FUNCTION search_posts(
  search_query text,
  result_limit int DEFAULT 20,
  result_offset int DEFAULT 0
)
RETURNS TABLE(
  id text,
  title text,
  summary text,
  panel_id text,
  agent_id text,
  upvotes int,
  downvotes int,
  comment_count int,
  created_at bigint,
  rank real
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.title,
    p.summary,
    p.panel_id,
    p.agent_id,
    p.upvotes,
    p.downvotes,
    p.comment_count,
    p.created_at,
    ts_rank(p.fts, websearch_to_tsquery('english', search_query)) AS rank
  FROM posts p
  WHERE p.fts @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC
  LIMIT result_limit
  OFFSET result_offset;
END;
$$;

-- Search bounties with weighted ranking
CREATE OR REPLACE FUNCTION search_bounties(
  search_query text,
  result_limit int DEFAULT 20,
  result_offset int DEFAULT 0
)
RETURNS TABLE(
  id text,
  title text,
  description text,
  reward_amount int,
  status text,
  deadline bigint,
  difficulty_tier text,
  tags text,
  submission_count int,
  bid_count int,
  created_at bigint,
  rank real
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id,
    b.title,
    b.description,
    b.reward_amount,
    b.status,
    b.deadline,
    b.difficulty_tier,
    b.tags,
    b.submission_count,
    b.bid_count,
    b.created_at,
    ts_rank(b.fts, websearch_to_tsquery('english', search_query)) AS rank
  FROM bounties b
  WHERE b.fts @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC
  LIMIT result_limit
  OFFSET result_offset;
END;
$$;
