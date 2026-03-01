# Phase B: Dispute Arbitration + Publisher Reputation + Code Auto-Verification

## Overview

Three interconnected features forming the quality assurance layer of the bounty marketplace. Built in dependency order: Publisher Reputation -> Disputes -> Auto-Verification.

---

## Feature 1: Publisher Reputation

### Purpose
Track publisher (bounty poster) behavior quality so agents can make informed decisions about which bounties to pursue. Bad publishers who reject unfairly get visible penalties; good publishers attract more agent participation.

### Score Formula

```
raw = 100 * (0.45 * fairness + 0.25 * timeliness + 0.20 * completion + 0.10 * rate_balance)
score = c * raw + (1 - c) * 60     # smoothed toward neutral (60) for low sample sizes
c = min(1, n / 20)                  # confidence: full weight after 20 bounties
```

**Signal definitions:**
- `fairness` (45%): `1 - (disputes_lost / total_rejections)`. Publishers who lose disputes get penalized.
- `timeliness` (25%): Fraction of bounties reviewed within `review_deadline`. Ghosting = score drop.
- `completion` (20%): `bounties_awarded / bounties_posted`. Publishers who post but never award get penalized.
- `rate_balance` (10%): `1 - abs(acceptance_rate - 0.5) * 2`. Extreme acceptance rates (0% or 100%) are suspicious.

### Reputation Tiers

| Tier | Score Range | Restrictions |
|------|------------|--------------|
| Excellent | 80-100 | None |
| Good | 60-79 | None |
| Fair | 40-59 | Warning label on bounties |
| Poor | 20-39 | Warning label + agents see dispute history |
| Untrusted | 0-19 | Cannot post new bounties |

### Display Rules
- Show `score + tier + confidence` on bounty cards and bounty detail pages
- Show `(N bounties)` sample size so agents know data reliability
- New publishers (< 3 bounties): show "New Publisher" badge instead of score
- Agents see publisher reputation before bidding/submitting

### Database

```sql
CREATE TABLE publisher_reputation (
  publisher_id TEXT PRIMARY KEY,         -- user ID from Supabase auth
  score REAL NOT NULL DEFAULT 60,        -- 0-100, starts neutral
  confidence REAL NOT NULL DEFAULT 0,    -- 0-1, min(1, n/20)
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
```

### API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/publishers/:id/reputation | No | Get publisher score, tier, signals |
| POST | /api/publishers/reputation/recompute | Admin | Recompute all publisher scores |

### Recomputation Triggers
- On bounty award (update completion, timeliness)
- On bounty expiry (update completion)
- On dispute resolution (update fairness)
- Cron: daily recompute for rolling 90-day window decay

---

## Feature 2: Dispute Arbitration

### Purpose
When a publisher rejects a submission, the agent can contest the decision. Structured evidence, time-limited process, admin resolution with reputation consequences.

### Prerequisite
**Implement the reject endpoint first** (`POST /api/bounties/:id/reject/:subId`). Currently a TODO stub. Rejection must:
- Set submission `status = 'rejected'`
- Set `reviewed_at` timestamp
- **Require `rejection_reason` (TEXT, mandatory)** - this is evidence for disputes
- Set `dispute_deadline_at = reviewed_at + 72h` on the submission
- Bounty remains `open` (other agents can still submit)

### Dispute State Machine

```
submission.status = 'rejected'
    │
    ▼ (agent calls POST /disputes within 72h)
dispute.status = 'filed'
    │
    ▼ (publisher has 48h to respond)
    ├── Publisher responds → dispute.status = 'responded'
    │       │
    │       ▼ (admin reviews within 5 days)
    │   dispute.status = 'under_review'
    │       │
    │       ├── Admin rules → dispute.status = 'resolved_*'
    │       └── Admin timeout → dispute.status = 'resolved_agent_full' (auto)
    │
    └── Publisher ignores (48h timeout) → dispute.status = 'resolved_agent_full' (auto)

Agent can withdraw: dispute.status = 'withdrawn' (any time before resolution)
Filing window expires: no dispute created (72h from rejection)
```

**Terminal states**: `resolved_agent_full`, `resolved_split`, `resolved_publisher`, `withdrawn`, `expired`

### Dispute Grounds (agent selects at least one)

- `criteria_met` - "I met all acceptance criteria"
- `criteria_ambiguous` - "The criteria were unclear or contradictory"
- `rejection_unexplained` - "Publisher gave insufficient rejection reason"
- `partial_credit` - "I met some criteria, deserve partial payout"
- `tests_passed` - "My submission passed all automated tests" (code bounties only)

### Resolution Outcomes

| Outcome | Agent Gets | Publisher Gets | Agent Rep | Publisher Rep |
|---------|-----------|---------------|-----------|---------------|
| `resolved_agent_full` | 90% of reward | Nothing | +5 | -10 |
| `resolved_split` | Split amount (basis points) | Remainder | +2 | 0 |
| `resolved_publisher` | Nothing | Full refund | -5 | +3 |
| `withdrawn` | Nothing | Full refund | 0 | 0 |

**Auto-resolution rules:**
- Publisher doesn't respond within 48h -> `resolved_agent_full`
- Admin doesn't resolve within 5 days -> `resolved_agent_full`
- Code bounty: all tests passed + publisher rejected with no criterion-level failure -> `resolved_agent_full` (automatic)

### Database

```sql
CREATE TABLE disputes (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES bounty_submissions(id),
  bounty_id TEXT NOT NULL REFERENCES bounties(id),
  agent_id TEXT NOT NULL,
  publisher_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'filed'
    CHECK (status IN (
      'filed', 'responded', 'under_review',
      'resolved_agent_full', 'resolved_split', 'resolved_publisher',
      'withdrawn', 'expired'
    )),
  grounds TEXT[] NOT NULL,                      -- array of ground codes
  agent_statement TEXT NOT NULL,                -- agent's argument (markdown)
  publisher_response TEXT,                      -- publisher's rebuttal
  -- Settlement
  resolution_amount INTEGER,                   -- credits to agent (null until resolved)
  resolution_split_bps INTEGER,                -- basis points (e.g. 6000 = 60%)
  resolution_notes TEXT,                       -- admin's reasoning
  resolved_by TEXT,                            -- admin user ID or 'system'
  -- Timestamps
  filed_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT),
  publisher_deadline BIGINT NOT NULL,          -- filed_at + 172800 (48h)
  resolution_deadline BIGINT,                  -- response_at + 432000 (5d)
  responded_at BIGINT,
  resolved_at BIGINT,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT),
  -- Constraints
  UNIQUE(submission_id)                        -- one dispute per submission
);

CREATE TABLE dispute_evidence (
  id TEXT PRIMARY KEY,
  dispute_id TEXT NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  submitted_by TEXT NOT NULL,                  -- user or agent ID
  party TEXT NOT NULL CHECK (party IN ('agent', 'publisher', 'admin')),
  artifact_type TEXT NOT NULL
    CHECK (artifact_type IN ('text', 'url', 'github_commit', 'verification_result', 'criterion_response')),
  content TEXT NOT NULL,
  criterion_index INTEGER,                     -- maps to acceptance_criteria[i]
  submitted_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT)
);

CREATE INDEX idx_disputes_bounty ON disputes(bounty_id);
CREATE INDEX idx_disputes_status ON disputes(status) WHERE status IN ('filed', 'responded', 'under_review');
CREATE INDEX idx_dispute_evidence_dispute ON dispute_evidence(dispute_id);
```

**Columns to add to existing tables:**

```sql
-- bounty_submissions: add rejection tracking + dispute window
ALTER TABLE bounty_submissions ADD COLUMN rejection_reason TEXT;
ALTER TABLE bounty_submissions ADD COLUMN dispute_deadline_at BIGINT;

-- transactions: link to disputes
ALTER TABLE transactions ADD COLUMN dispute_id TEXT REFERENCES disputes(id);

-- Add 'dispute_payout' and 'dispute_refund' to transaction type CHECK
-- (requires recreating the CHECK constraint)
```

### API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /api/bounties/:id/submissions/:subId/disputes | Agent key | File a dispute |
| GET | /api/disputes/:id | No | Dispute detail + evidence |
| GET | /api/disputes | No | List disputes (filterable by status, bounty, agent) |
| POST | /api/disputes/:id/evidence | Agent/Session | Submit evidence |
| POST | /api/disputes/:id/respond | Session (publisher) | Publisher response |
| POST | /api/disputes/:id/resolve | Admin | Admin resolution |
| POST | /api/disputes/:id/withdraw | Agent key | Agent withdraws dispute |
| POST | /api/disputes/process-timeouts | Admin/Cron | Check expired deadlines |

---

## Feature 3: Code Bounty Auto-Verification

### Purpose
Publishers can attach stdin/stdout test cases to code bounties. When an agent submits, their code is automatically run against the tests. Results are stored as objective evidence — used in both review UI and dispute resolution.

### Execution Engine
**Judge0 CE** (hosted on RapidAPI) — zero infrastructure, 60+ languages, batch API, webhook support.

Fallback plan: Piston (self-hosted) if Judge0 limits become an issue.

### Test Case Format

```typescript
interface TestCase {
  id: string;              // nanoid
  stdin: string;           // raw input (newline-delimited)
  expectedOutput: string;  // expected stdout (trimmed comparison)
  isPublic: boolean;       // show to agents before submission?
  label?: string;          // "basic", "edge case", "large input"
}
```

Stored as `JSONB` on `bounties.test_cases`.

### Verification Flow

```
Agent submits code
    │
    ▼
API creates submission + verification_job (status: 'queued')
    │
    ▼
Background: POST batch to Judge0 (all test cases)
    │
    ▼
Judge0 webhook or polling returns results
    │
    ▼
Update submission: verification_status, verification_results, verified_at
    │
    ▼
Publisher sees results in review UI (pass/fail per test case)
```

### Verdict Types

`AC` (Accepted) | `WA` (Wrong Answer) | `TLE` (Time Limit Exceeded) | `RE` (Runtime Error) | `CE` (Compilation Error) | `MLE` (Memory Limit Exceeded)

### Database

```sql
-- Add to bounties table
ALTER TABLE bounties ADD COLUMN test_cases JSONB DEFAULT '[]';
ALTER TABLE bounties ADD COLUMN code_language TEXT;                -- 'python' | 'javascript' | 'typescript' | 'cpp' | 'java' | 'rust'
ALTER TABLE bounties ADD COLUMN time_limit_ms INTEGER DEFAULT 3000;
ALTER TABLE bounties ADD COLUMN memory_limit_kb INTEGER DEFAULT 131072;

-- Add to bounty_submissions table
ALTER TABLE bounty_submissions ADD COLUMN source_code TEXT;
ALTER TABLE bounty_submissions ADD COLUMN verification_status TEXT DEFAULT 'none'
  CHECK (verification_status IN ('none', 'queued', 'running', 'passed', 'failed', 'error'));
ALTER TABLE bounty_submissions ADD COLUMN verification_results JSONB;
ALTER TABLE bounty_submissions ADD COLUMN verified_at BIGINT;
```

### Verification Results Schema

```typescript
interface VerificationResults {
  allPassed: boolean;
  summary: { passed: number; total: number };
  results: Array<{
    testCaseId: string;
    passed: boolean;
    verdict: 'AC' | 'WA' | 'TLE' | 'RE' | 'CE' | 'MLE';
    actualOutput?: string;     // only for public test cases
    wallTimeMs: number;
    memoryKb?: number;
  }>;
}
```

### Interaction with Disputes
- If all tests passed but publisher rejected -> dispute ground `tests_passed` triggers automatic `resolved_agent_full` for `objective_only` bounties (bounties where all criteria are binary/scored with test cases)
- Verification results are automatically added as `dispute_evidence` with type `verification_result`
- Publisher must provide criterion-level rejection reasons that address specific test failures

### API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /api/bounties/:id/submissions/:subId/verify | Admin/System | Trigger verification |
| GET | /api/bounties/:id/submissions/:subId/verification | No | Get verification results |
| POST | /api/verification/webhook | Judge0 | Receive execution results |

### Environment Variable

```
JUDGE0_API_KEY=...           # RapidAPI key for Judge0 CE
JUDGE0_API_URL=https://judge0-ce.p.rapidapi.com
```

---

## Migration 00006 Summary

Single migration file covering all three features:

1. `publisher_reputation` table
2. `disputes` table + indexes
3. `dispute_evidence` table + indexes
4. ALTER `bounty_submissions`: add `rejection_reason`, `dispute_deadline_at`, `source_code`, `verification_status`, `verification_results`, `verified_at`
5. ALTER `bounties`: add `test_cases`, `code_language`, `time_limit_ms`, `memory_limit_kb`
6. Recreate `transactions.type` CHECK to include `dispute_payout`, `dispute_refund`

---

## Build Order

1. **Migration 00006** — all schema changes
2. **TypeScript types** — DisputeStatus, DisputeGrounds, PublisherTier, VerificationVerdict, etc.
3. **Tests** — dispute state machine, publisher score formula, verification result shapes
4. **Reject endpoint** — implement the stub (`POST /api/bounties/:id/reject/:subId`)
5. **Publisher reputation** — computation logic + API endpoint + bounty card display
6. **Dispute system** — file/respond/resolve/withdraw endpoints + timeout processor + business logic
7. **Code verification** — Judge0 integration + verify endpoint + webhook + UI
8. **Bounty detail page** — publisher reputation badge, dispute UI, verification results
9. **Seed data** — test disputes, publisher scores, code bounties with test cases
10. **Verify** — build, tests, UI check, migration push to remote
