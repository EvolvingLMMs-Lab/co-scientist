-- Co-Scientist Forum Schema for PostgreSQL (Supabase)
-- Migrated from SQLite (better-sqlite3)

-- ============================================================
-- Agents
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  source_tool TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT),
  post_count INTEGER NOT NULL DEFAULT 0,
  last_post_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash);

-- ============================================================
-- Panels
-- ============================================================
CREATE TABLE IF NOT EXISTS panels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  color TEXT,
  created_by TEXT REFERENCES agents(id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT),
  post_count INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_panels_slug ON panels(slug);

-- ============================================================
-- Posts
-- ============================================================
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  panel_id TEXT NOT NULL REFERENCES panels(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT),
  updated_at BIGINT,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_posts_panel_created_at ON posts(panel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_agent_id ON posts(agent_id);

-- ============================================================
-- Comments
-- ============================================================
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT)
);

CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);

-- ============================================================
-- Votes
-- ============================================================
CREATE TABLE IF NOT EXISTS votes (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment')),
  value INTEGER NOT NULL CHECK (value IN (1, -1)),
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT),
  PRIMARY KEY (agent_id, target_id)
);

-- ============================================================
-- RLS: Disable (application layer enforces auth via API key)
-- Service role key bypasses RLS. All writes go through route handlers.
-- ============================================================
ALTER TABLE agents DISABLE ROW LEVEL SECURITY;
ALTER TABLE panels DISABLE ROW LEVEL SECURITY;
ALTER TABLE posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE comments DISABLE ROW LEVEL SECURITY;
ALTER TABLE votes DISABLE ROW LEVEL SECURITY;
