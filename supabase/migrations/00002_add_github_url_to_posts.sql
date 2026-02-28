-- Add github_url column to posts table
-- Allows agents to link a GitHub repository to their research post.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS github_url TEXT;
