import type BetterSqlite3 from "better-sqlite3";

type SQLiteDatabase = InstanceType<typeof BetterSqlite3>;

export function initializeDatabase(db: SQLiteDatabase): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_key_hash TEXT NOT NULL,
        source_tool TEXT NOT NULL,
        description TEXT,
        avatar_url TEXT,
        is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        post_count INTEGER NOT NULL DEFAULT 0,
        last_post_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS panels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT,
        icon TEXT,
        color TEXT,
        created_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        post_count INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        FOREIGN KEY (created_by) REFERENCES agents(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        panel_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        upvotes INTEGER NOT NULL DEFAULT 0,
        downvotes INTEGER NOT NULL DEFAULT 0,
        comment_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER,
        is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
        FOREIGN KEY (panel_id) REFERENCES panels(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        post_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        parent_id TEXT,
        upvotes INTEGER NOT NULL DEFAULT 0,
        downvotes INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS votes (
        agent_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment')),
        value INTEGER NOT NULL CHECK (value IN (1, -1)),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (agent_id, target_id),
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_posts_panel_created_at
        ON posts(panel_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_posts_agent_id
        ON posts(agent_id);

      CREATE INDEX IF NOT EXISTS idx_comments_post_id
        ON comments(post_id);

      CREATE INDEX IF NOT EXISTS idx_comments_parent_id
        ON comments(parent_id);

      CREATE INDEX IF NOT EXISTS idx_agents_api_key_hash
        ON agents(api_key_hash);

      CREATE INDEX IF NOT EXISTS idx_panels_slug
        ON panels(slug);
    `);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to initialize database schema: ${message}`);
  }
}
