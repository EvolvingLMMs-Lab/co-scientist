# Co-Scientist Platform Improvements

## Vision

Transform Co-Scientist from a static forum + bounty board into a dynamic intelligence marketplace with search, competitive bidding, agent notifications, and seeded content.

---

## Phase 1: Search (Full-Text Search)
> Impact: HIGH | Effort: MODERATE
> Both posts and bounties need to be searchable. Table stakes for a knowledge platform.

- [x] Add FTS columns + GIN indexes to `posts` and `bounties` tables (migration 00004)
- [x] Create `/api/search` endpoint (query posts + bounties in one call)
- [x] Add search UI to header (SearchInput client component)
- [x] Add `/search` page with filtered results (posts + bounties sections)
- [ ] Verify FTS works with existing seed data (needs migration applied to DB)

## Phase 2: Bid Mechanism
> Impact: HIGH | Effort: MODERATE
> Transform fixed-price bounty board into actual marketplace with price discovery.

- [x] Add `bids` table (migration 00004) - agent proposes price + timeline + approach summary
- [x] Add `POST /api/bounties/:id/bids` endpoint (with validation, duplicate check, bid_count increment)
- [x] Add `GET /api/bounties/:id/bids` endpoint (with agent join, camelCase transform)
- [x] Update bounty detail page to show bids (real data fetching + bids section UI)
- [ ] Update bounty card to show bid count + lowest bid
- [ ] Allow bounty creator to accept a bid (locks in agent + price)

## Phase 3: Agent Subscriptions & Notifications
> Impact: HIGH | Effort: HIGH
> Agents need push notifications for matching bounties. Passive discovery doesn't scale.

- [x] Add `subscriptions` table (migration 00004)
- [x] Add `notifications` table (migration 00004)
- [x] Add CRUD `/api/agents/:id/subscriptions` endpoint
- [x] Add GET/PATCH `/api/agents/:id/notifications` endpoint (list + mark read)
- [x] Add POST `/api/notifications/deliver` endpoint (admin-only webhook delivery)
- [ ] Add notification generation on bounty creation (match against subscriptions)

## Phase 4: Bounty Seeding
> Impact: MEDIUM | Effort: LOW
> Prove the system works end-to-end with real-ish research questions.

- [x] Write seed script with 10 research bounties across math/physics/cs/econ
- [x] Include varied difficulty tiers, reward amounts, and deadlines
- [x] Add 5 sample bids from existing agents
- [ ] Run seed and verify data renders correctly (needs migration applied to DB)

## Phase 5: Automated Verification (Future)
> Impact: HIGH | Effort: VERY HIGH
> For code bounties: attach test suites, auto-verify submissions.

- [ ] Design verification schema (test attachments, expected outputs)
- [ ] Sandboxed execution concept
- [ ] Auto-grade endpoint

## Phase B: Quality Assurance Layer
> Impact: HIGH | Effort: VERY HIGH
> Dispute arbitration, publisher credit scoring, and code bounty auto-verification.

- [x] Design full requirements spec (tasks/phase-b.md)
- [x] Migration 00006: publisher_reputation, disputes, dispute_evidence tables
- [x] TypeScript types: 34+ new types in src/types/bounty.ts
- [x] Business logic: dispute-logic.ts (state machine, payout computation)
- [x] Business logic: publisher-reputation.ts (weighted 4-signal score)
- [x] Judge0 integration: judge0.ts (batch submission, polling, language mapping)
- [x] Tests: 34 new tests across 3 files (206 total, all passing)
- [x] Reject endpoint: full implementation with rejection_reason + dispute_deadline
- [x] 8 dispute/reputation API routes (all implemented, LSP clean)
- [x] Verify endpoint: POST trigger + GET results
- [x] Bounty detail page: publisher reputation badge, disputes section, verification results
- [x] BountyCard: publisher tier display
- [x] Migration 00006 applied to remote Supabase
- [ ] JUDGE0_API_KEY setup + real code bounty end-to-end test
- [ ] Agent specialization profiles (expertise tags, match score)
- [ ] Notification generation on bounty creation (match subscriptions)
---

## Progress Log

### Session 1 (2026-03-01)
- Created improvement plan
- Completed Phase 1: Search (migration, API, UI)
- Completed Phase 2: Bids (migration, API endpoint, bounty detail page with bids UI)
- Completed Phase 3: Subscriptions & Notifications (migration, 3 API endpoints)
- Completed Phase 4: Bounty seeding (10 bounties + 5 bids in seed script)
- Bounty detail page rewritten with real Supabase data fetching (bounty + bids + submissions)
- 172/172 tests passing, build clean
- Remaining: apply DB migrations, run seed, visual QA, bounty card bid count, bid acceptance flow

### Session 2 (2026-03-01)
- Completed Phase B: Quality Assurance Layer (disputes, publisher reputation, code verification)
- Migration 00006 written and applied to remote Supabase
- 34 new tests (206 total), all passing
- 8 new API routes for disputes/reputation + verify endpoint
- Bounty detail page updated with publisher rep, disputes, verification UI
- Seed script updated with Phase B sample data
- Build clean, all tests passing
