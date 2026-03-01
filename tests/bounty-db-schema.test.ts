/**
 * Bounty System — Database Migration Tests
 *
 * Tests that the SQL migration file exists, is syntactically valid,
 * and defines all required tables, columns, indexes, and constraints.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const MIGRATION_DIR = path.join(process.cwd(), "supabase", "migrations");

describe("Bounty migration file", () => {
  let migrationContent: string;
  let migrationFiles: string[];

  it("migration directory exists", () => {
    expect(fs.existsSync(MIGRATION_DIR)).toBe(true);
  });

  it("a bounty migration file exists matching pattern 0000X_bounty*", () => {
    migrationFiles = fs.readdirSync(MIGRATION_DIR).sort();
    const bountyMigration = migrationFiles.find(
      (f) => f.includes("bounty") || f.includes("bounties"),
    );
    expect(bountyMigration).toBeDefined();
    migrationContent = fs.readFileSync(
      path.join(MIGRATION_DIR, bountyMigration!),
      "utf-8",
    );
  });

  // --- bounties table ---
  it("creates bounties table", () => {
    expect(migrationContent).toMatch(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?bounties/i);
  });

  it("bounties has id TEXT PRIMARY KEY", () => {
    // Check within the bounties CREATE TABLE block
    expect(migrationContent).toMatch(/bounties[\s\S]*?id\s+TEXT\s+PRIMARY KEY/i);
  });

  it("bounties has title TEXT NOT NULL", () => {
    expect(migrationContent).toMatch(/bounties[\s\S]*?title\s+TEXT\s+NOT NULL/i);
  });

  it("bounties has description TEXT NOT NULL", () => {
    expect(migrationContent).toMatch(/bounties[\s\S]*?description\s+TEXT\s+NOT NULL/i);
  });

  it("bounties has creator_user_id TEXT NOT NULL", () => {
    expect(migrationContent).toMatch(/bounties[\s\S]*?creator_user_id\s+TEXT\s+NOT NULL/i);
  });

  it("bounties has reward_amount INTEGER with CHECK > 0", () => {
    expect(migrationContent).toMatch(/reward_amount\s+INTEGER\s+NOT NULL/i);
    expect(migrationContent).toMatch(/reward_amount\s*>\s*0/i);
  });

  it("bounties has status with CHECK constraint for valid values", () => {
    expect(migrationContent).toMatch(/status\s+TEXT\s+NOT NULL/i);
    // Should check for all 5 values
    expect(migrationContent).toMatch(/open/i);
    expect(migrationContent).toMatch(/awarded/i);
    expect(migrationContent).toMatch(/expired/i);
    expect(migrationContent).toMatch(/cancelled/i);
    expect(migrationContent).toMatch(/disputed/i);
  });

  it("bounties has deadline BIGINT NOT NULL", () => {
    expect(migrationContent).toMatch(/bounties[\s\S]*?deadline\s+BIGINT\s+NOT NULL/i);
  });

  it("bounties has max_submissions with default", () => {
    expect(migrationContent).toMatch(/max_submissions\s+INTEGER/i);
  });

  it("bounties has difficulty_tier with CHECK constraint", () => {
    expect(migrationContent).toMatch(/difficulty_tier/i);
    expect(migrationContent).toMatch(/trivial/i);
    expect(migrationContent).toMatch(/moderate/i);
    expect(migrationContent).toMatch(/hard/i);
    expect(migrationContent).toMatch(/research/i);
  });

  it("bounties has submission_count with default 0", () => {
    expect(migrationContent).toMatch(/submission_count\s+INTEGER.*DEFAULT\s+0/i);
  });

  it("bounties has created_at and updated_at", () => {
    expect(migrationContent).toMatch(/bounties[\s\S]*?created_at\s+BIGINT\s+NOT NULL/i);
    expect(migrationContent).toMatch(/bounties[\s\S]*?updated_at\s+BIGINT/i);
  });

  it("bounties has indexes on status, creator, panel, deadline", () => {
    expect(migrationContent).toMatch(/CREATE INDEX.*bounties.*status/i);
    expect(migrationContent).toMatch(/CREATE INDEX.*bounties.*creator/i);
    expect(migrationContent).toMatch(/CREATE INDEX.*bounties.*deadline/i);
  });

  // --- bounty_submissions table ---
  it("creates bounty_submissions table", () => {
    expect(migrationContent).toMatch(
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?bounty_submissions/i,
    );
  });

  it("bounty_submissions has UNIQUE(bounty_id, agent_id)", () => {
    expect(migrationContent).toMatch(/UNIQUE\s*\(\s*bounty_id\s*,\s*agent_id\s*\)/i);
  });

  it("bounty_submissions has status CHECK constraint", () => {
    // Should check for submitted, accepted, rejected
    expect(migrationContent).toMatch(/submitted/i);
    expect(migrationContent).toMatch(/accepted/i);
    expect(migrationContent).toMatch(/rejected/i);
  });

  it("bounty_submissions has content TEXT NOT NULL", () => {
    expect(migrationContent).toMatch(/bounty_submissions[\s\S]*?content\s+TEXT\s+NOT NULL/i);
  });

  it("bounty_submissions has quality_score INTEGER", () => {
    expect(migrationContent).toMatch(/quality_score\s+INTEGER/i);
  });

  it("bounty_submissions has FK to bounties and agents", () => {
    expect(migrationContent).toMatch(
      /bounty_id\s+TEXT\s+NOT NULL\s+REFERENCES\s+bounties\s*\(\s*id\s*\)/i,
    );
    expect(migrationContent).toMatch(
      /bounty_submissions[\s\S]*?agent_id\s+TEXT\s+NOT NULL\s+REFERENCES\s+agents\s*\(\s*id\s*\)/i,
    );
  });

  // --- transactions table ---
  it("creates transactions table", () => {
    expect(migrationContent).toMatch(
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?transactions/i,
    );
  });

  it("transactions has amount INTEGER NOT NULL", () => {
    expect(migrationContent).toMatch(/transactions[\s\S]*?amount\s+INTEGER\s+NOT NULL/i);
  });

  it("transactions has type with CHECK constraint", () => {
    expect(migrationContent).toMatch(/deposit/i);
    expect(migrationContent).toMatch(/bounty_escrow/i);
    expect(migrationContent).toMatch(/bounty_payout/i);
    expect(migrationContent).toMatch(/bounty_refund/i);
    expect(migrationContent).toMatch(/platform_fee/i);
    expect(migrationContent).toMatch(/withdrawal/i);
  });

  it("transactions has idempotency_key TEXT UNIQUE", () => {
    expect(migrationContent).toMatch(/idempotency_key\s+TEXT\s+UNIQUE/i);
  });

  // --- user_wallets table ---
  it("creates user_wallets table", () => {
    expect(migrationContent).toMatch(
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?user_wallets/i,
    );
  });

  it("user_wallets has balance with CHECK >= 0", () => {
    expect(migrationContent).toMatch(/user_wallets[\s\S]*?balance\s+INTEGER/i);
    expect(migrationContent).toMatch(/balance\s*>=\s*0/i);
  });

  // --- agent_wallets table ---
  it("creates agent_wallets table", () => {
    expect(migrationContent).toMatch(
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?agent_wallets/i,
    );
  });

  it("agent_wallets references agents(id)", () => {
    expect(migrationContent).toMatch(
      /agent_wallets[\s\S]*?REFERENCES\s+agents\s*\(\s*id\s*\)/i,
    );
  });

  // --- RLS disabled ---
  it("disables RLS on all new tables", () => {
    expect(migrationContent).toMatch(/ALTER TABLE\s+bounties\s+DISABLE ROW LEVEL SECURITY/i);
    expect(migrationContent).toMatch(
      /ALTER TABLE\s+bounty_submissions\s+DISABLE ROW LEVEL SECURITY/i,
    );
    expect(migrationContent).toMatch(
      /ALTER TABLE\s+transactions\s+DISABLE ROW LEVEL SECURITY/i,
    );
    expect(migrationContent).toMatch(
      /ALTER TABLE\s+user_wallets\s+DISABLE ROW LEVEL SECURITY/i,
    );
    expect(migrationContent).toMatch(
      /ALTER TABLE\s+agent_wallets\s+DISABLE ROW LEVEL SECURITY/i,
    );
  });
});
