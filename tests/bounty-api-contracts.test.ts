/**
 * Bounty System — API Contract Tests
 *
 * Tests the API route handlers exist and have correct signatures.
 * These are "contract" tests — they verify the module shape, not DB behavior.
 * Each test imports the route handler and verifies it's a valid HTTP handler.
 */
import { describe, it, expect } from "vitest";

describe("Bounty API route modules exist with correct exports", () => {
  // --- /api/bounties ---
  it("GET /api/bounties handler exists", async () => {
    const mod = await import("@/app/api/bounties/route");
    expect(mod.GET).toBeTypeOf("function");
  });

  it("POST /api/bounties handler exists", async () => {
    const mod = await import("@/app/api/bounties/route");
    expect(mod.POST).toBeTypeOf("function");
  });

  // --- /api/bounties/[id] ---
  it("GET /api/bounties/[id] handler exists", async () => {
    const mod = await import("@/app/api/bounties/[id]/route");
    expect(mod.GET).toBeTypeOf("function");
  });

  it("PATCH /api/bounties/[id] handler exists", async () => {
    const mod = await import("@/app/api/bounties/[id]/route");
    expect(mod.PATCH).toBeTypeOf("function");
  });

  it("DELETE /api/bounties/[id] handler exists", async () => {
    const mod = await import("@/app/api/bounties/[id]/route");
    expect(mod.DELETE).toBeTypeOf("function");
  });

  // --- /api/bounties/[id]/submissions ---
  it("GET /api/bounties/[id]/submissions handler exists", async () => {
    const mod = await import("@/app/api/bounties/[id]/submissions/route");
    expect(mod.GET).toBeTypeOf("function");
  });

  it("POST /api/bounties/[id]/submissions handler exists", async () => {
    const mod = await import("@/app/api/bounties/[id]/submissions/route");
    expect(mod.POST).toBeTypeOf("function");
  });

  // --- /api/bounties/[id]/award ---
  it("POST /api/bounties/[id]/award handler exists", async () => {
    const mod = await import("@/app/api/bounties/[id]/award/route");
    expect(mod.POST).toBeTypeOf("function");
  });

  // --- /api/bounties/[id]/reject ---
  it("POST /api/bounties/[id]/reject/[subId] handler exists", async () => {
    const mod = await import("@/app/api/bounties/[id]/reject/[subId]/route");
    expect(mod.POST).toBeTypeOf("function");
  });

  // --- /api/wallet ---
  it("GET /api/wallet handler exists", async () => {
    const mod = await import("@/app/api/wallet/route");
    expect(mod.GET).toBeTypeOf("function");
  });

  // --- /api/agents/[id]/reputation ---
  it("GET /api/agents/[id]/reputation handler exists", async () => {
    const mod = await import("@/app/api/agents/[id]/reputation/route");
    expect(mod.GET).toBeTypeOf("function");
  });

  // --- /api/leaderboard ---
  it("GET /api/leaderboard handler exists", async () => {
    const mod = await import("@/app/api/leaderboard/route");
    expect(mod.GET).toBeTypeOf("function");
  });
});

describe("Bounty API handlers return valid Response objects", () => {
  // Smoke tests: call handlers with minimal/invalid input and verify
  // they return Response objects (not crashes)

  it("GET /api/bounties returns a Response", async () => {
    const mod = await import("@/app/api/bounties/route");
    const request = new Request("http://localhost:3000/api/bounties");
    const response = await mod.GET(request);
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("POST /api/bounties without auth returns 401", async () => {
    const mod = await import("@/app/api/bounties/route");
    const request = new Request("http://localhost:3000/api/bounties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const response = await mod.POST(request);
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(401);
  });

  it("GET /api/leaderboard returns a Response", async () => {
    const mod = await import("@/app/api/leaderboard/route");
    const request = new Request("http://localhost:3000/api/leaderboard");
    const response = await mod.GET(request);
    expect(response).toBeInstanceOf(Response);
  });
});
