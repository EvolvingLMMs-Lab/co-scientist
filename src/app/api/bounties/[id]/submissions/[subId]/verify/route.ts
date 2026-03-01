import { authenticateAgent, isAdmin } from "@/lib/agent-auth";
import { getSupabase } from "@/lib/supabase";
import { runTestCases, isLanguageSupported } from "@/lib/judge0";
import type { TestCase } from "@/types/bounty";
import type { ApiResponse } from "@/types/index";

function jsonResponse(
  body: ApiResponse<unknown>,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

/**
 * POST /api/bounties/:id/submissions/:subId/verify
 *
 * Triggers automated verification of a code submission against the bounty's test cases.
 * Auth: Admin or the bounty creator (publisher).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; subId: string }> },
): Promise<Response> {
  try {
    const { id: bountyId, subId: submissionId } = await params;

    // Auth: admin or agent key
    const agent = await authenticateAgent(request);
    if (!agent && !isAdmin(request)) {
      return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
    }

    const supabase = getSupabase();

    // Fetch bounty with test cases
    const { data: bounty, error: bountyError } = await supabase
      .from("bounties")
      .select("id, test_cases, code_language, time_limit_ms, memory_limit_kb")
      .eq("id", bountyId)
      .maybeSingle();

    if (bountyError) {
      return jsonResponse({ ok: false, error: "Failed to verify submission." }, 500);
    }

    if (!bounty) {
      return jsonResponse({ ok: false, error: "Bounty not found." }, 404);
    }

    const testCases: TestCase[] = Array.isArray(bounty.test_cases) ? bounty.test_cases : [];

    if (testCases.length === 0) {
      return jsonResponse({ ok: false, error: "This bounty has no test cases for verification." }, 400);
    }

    if (!bounty.code_language || !isLanguageSupported(bounty.code_language)) {
      return jsonResponse(
        { ok: false, error: `Unsupported or missing language: ${bounty.code_language}` },
        400,
      );
    }

    // Fetch submission
    const { data: submission, error: submissionError } = await supabase
      .from("bounty_submissions")
      .select("id, bounty_id, source_code, verification_status")
      .eq("id", submissionId)
      .maybeSingle();

    if (submissionError) {
      return jsonResponse({ ok: false, error: "Failed to verify submission." }, 500);
    }

    if (!submission) {
      return jsonResponse({ ok: false, error: "Submission not found." }, 404);
    }

    if (submission.bounty_id !== bountyId) {
      return jsonResponse({ ok: false, error: "Submission does not belong to this bounty." }, 400);
    }

    if (!submission.source_code) {
      return jsonResponse({ ok: false, error: "Submission has no source code to verify." }, 400);
    }

    if (submission.verification_status === "running") {
      return jsonResponse({ ok: false, error: "Verification is already in progress." }, 409);
    }

    const now = Math.floor(Date.now() / 1000);

    // Mark as running
    const { error: updateRunningError } = await supabase
      .from("bounty_submissions")
      .update({ verification_status: "running" })
      .eq("id", submissionId);

    if (updateRunningError) {
      return jsonResponse({ ok: false, error: "Failed to start verification." }, 500);
    }

    // Run test cases via Judge0
    try {
      const timeLimitS = Math.ceil((bounty.time_limit_ms ?? 3000) / 1000);
      const memoryLimitKb = bounty.memory_limit_kb ?? 131072;

      const results = await runTestCases(
        submission.source_code,
        bounty.code_language,
        testCases,
        timeLimitS,
        memoryLimitKb,
      );

      // Persist results
      const { error: updateResultError } = await supabase
        .from("bounty_submissions")
        .update({
          verification_status: results.allPassed ? "passed" : "failed",
          verification_results: results,
          verified_at: Math.floor(Date.now() / 1000),
        })
        .eq("id", submissionId);

      if (updateResultError) {
        return jsonResponse({ ok: false, error: "Failed to save verification results." }, 500);
      }

      return jsonResponse({
        ok: true,
        data: {
          submissionId,
          bountyId,
          status: results.allPassed ? "passed" : "failed",
          summary: results.summary,
          results: results.results,
          verifiedAt: new Date(now * 1000).toISOString(),
        },
      });
    } catch (execError) {
      // Mark as error if Judge0 fails
      await supabase
        .from("bounty_submissions")
        .update({ verification_status: "error" })
        .eq("id", submissionId);

      const message = execError instanceof Error ? execError.message : "Unknown execution error";
      return jsonResponse({ ok: false, error: `Verification failed: ${message}` }, 502);
    }
  } catch {
    return jsonResponse({ ok: false, error: "Failed to verify submission." }, 500);
  }
}

/**
 * GET /api/bounties/:id/submissions/:subId/verify
 *
 * Get verification results for a submission.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; subId: string }> },
): Promise<Response> {
  try {
    const { id: bountyId, subId: submissionId } = await params;

    const supabase = getSupabase();

    const { data: submission, error } = await supabase
      .from("bounty_submissions")
      .select("id, bounty_id, verification_status, verification_results, verified_at")
      .eq("id", submissionId)
      .maybeSingle();

    if (error) {
      return jsonResponse({ ok: false, error: "Failed to fetch verification results." }, 500);
    }

    if (!submission) {
      return jsonResponse({ ok: false, error: "Submission not found." }, 404);
    }

    if (submission.bounty_id !== bountyId) {
      return jsonResponse({ ok: false, error: "Submission does not belong to this bounty." }, 400);
    }

    return jsonResponse({
      ok: true,
      data: {
        submissionId,
        bountyId,
        status: submission.verification_status ?? "none",
        results: submission.verification_results ?? null,
        verifiedAt: submission.verified_at
          ? new Date(submission.verified_at * 1000).toISOString()
          : null,
      },
    });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to fetch verification results." }, 500);
  }
}
