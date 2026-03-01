import { nanoid } from "nanoid";
import { authenticateAgent } from "@/lib/agent-auth";
import { notifyMatchingSubscribers } from "@/lib/notify-subscribers";
import { getSupabase } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import type { ApiResponse } from "@/types/index";
import type { AcceptanceCriterion, DifficultyTier } from "@/types/bounty";

function jsonResponse(
  body: ApiResponse<unknown>,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "open";
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get("perPage") ?? "20") || 20));

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("bounties")
      .select("*")
      .eq("status", status)
      .order("created_at", { ascending: false })
      .range((page - 1) * perPage, page * perPage - 1);

    if (error) {
      return jsonResponse({ ok: false, error: "Failed to fetch bounties." }, 500);
    }

    return jsonResponse({ ok: true, data: data ?? [] });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to fetch bounties." }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  // Auth: either agent API key or logged-in user session
  let creatorUserId: string | null = null;

  const agent = await authenticateAgent(request);
  if (agent) {
    // Agent creating bounty on behalf of its operator — use agent.id as creator
    creatorUserId = agent.id;
  } else {
    // Try Supabase session (human user creating via web UI)
    try {
      const supabaseAuth = await createClient();
      const { data: { user } } = await supabaseAuth.auth.getUser();
      creatorUserId = user?.id ?? null;
    } catch {
      // No session
    }
  }

  if (!creatorUserId) {
    return jsonResponse({ ok: false, error: "Unauthorized. Provide an API key or sign in." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
  }

  if (typeof body !== "object" || body === null) {
    return jsonResponse({ ok: false, error: "Request body must be a JSON object." }, 400);
  }

  const {
    title,
    description,
    rewardAmount,
    deadline,
    panel,
    maxSubmissions,
    difficultyTier,
    evaluationCriteria,
    acceptanceCriteria,
    tags,
  } = body as Record<string, unknown>;

  // --- Validation ---

  if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 300) {
    return jsonResponse({ ok: false, error: "title must be 3-300 characters." }, 400);
  }

  if (typeof description !== "string" || description.trim().length < 10 || description.trim().length > 50000) {
    return jsonResponse({ ok: false, error: "description must be 10-50000 characters." }, 400);
  }

  if (typeof rewardAmount !== "number" || !Number.isInteger(rewardAmount) || rewardAmount < 100) {
    return jsonResponse({ ok: false, error: "rewardAmount must be an integer >= 100 (credits)." }, 400);
  }

  if (typeof deadline !== "number" || !Number.isInteger(deadline) || deadline <= Math.floor(Date.now() / 1000)) {
    return jsonResponse({ ok: false, error: "deadline must be a future Unix timestamp (seconds)." }, 400);
  }

  const validDifficulty = ["trivial", "moderate", "hard", "research"];
  if (difficultyTier !== undefined && (typeof difficultyTier !== "string" || !validDifficulty.includes(difficultyTier))) {
    return jsonResponse({ ok: false, error: "difficultyTier must be one of: trivial, moderate, hard, research." }, 400);
  }

  if (maxSubmissions !== undefined && (typeof maxSubmissions !== "number" || !Number.isInteger(maxSubmissions) || maxSubmissions < 1 || maxSubmissions > 100)) {
    return jsonResponse({ ok: false, error: "maxSubmissions must be an integer 1-100." }, 400);
  }

  if (evaluationCriteria !== undefined && evaluationCriteria !== null && (typeof evaluationCriteria !== "string" || evaluationCriteria.trim().length > 5000)) {
    return jsonResponse({ ok: false, error: "evaluationCriteria must be a string, max 5000 characters." }, 400);
  }

  // Validate acceptanceCriteria structure
  let parsedCriteria: AcceptanceCriterion[] = [];
  if (acceptanceCriteria !== undefined && acceptanceCriteria !== null) {
    if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length > 20) {
      return jsonResponse({ ok: false, error: "acceptanceCriteria must be an array of up to 20 items." }, 400);
    }
    for (let i = 0; i < acceptanceCriteria.length; i++) {
      const c = acceptanceCriteria[i] as Record<string, unknown>;
      if (!c || typeof c.criterion !== "string" || c.criterion.trim().length === 0) {
        return jsonResponse({ ok: false, error: `acceptanceCriteria[${i}].criterion is required.` }, 400);
      }
      if (c.type !== "binary" && c.type !== "scored") {
        return jsonResponse({ ok: false, error: `acceptanceCriteria[${i}].type must be "binary" or "scored".` }, 400);
      }
      if (c.weight !== undefined && (typeof c.weight !== "number" || c.weight < 1 || c.weight > 10)) {
        return jsonResponse({ ok: false, error: `acceptanceCriteria[${i}].weight must be 1-10.` }, 400);
      }
      parsedCriteria.push({
        criterion: (c.criterion as string).trim(),
        type: c.type as AcceptanceCriterion["type"],
        weight: (c.weight as number | undefined) ?? 1,
      });
    }
  }

  let parsedTags: string[] = [];
  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags) || tags.length > 10) {
      return jsonResponse({ ok: false, error: "tags must be an array of up to 10 strings." }, 400);
    }
    for (const t of tags) {
      if (typeof t !== "string" || t.trim().length === 0) {
        return jsonResponse({ ok: false, error: "Each tag must be a non-empty string." }, 400);
      }
      parsedTags.push(t.trim().toLowerCase());
    }
  }

  // --- Resolve panel ---
  let panelId: string | null = null;
  if (panel !== undefined && panel !== null) {
    if (typeof panel !== "string") {
      return jsonResponse({ ok: false, error: "panel must be a string (panel slug)." }, 400);
    }
    const supabase = getSupabase();
    const { data: panelRow } = await supabase
      .from("panels")
      .select("id")
      .eq("slug", panel.trim())
      .maybeSingle();
    if (!panelRow) {
      return jsonResponse({ ok: false, error: `Panel "${panel}" not found.` }, 404);
    }
    panelId = panelRow.id;
  }

  // --- Insert bounty ---
  try {
    const supabase = getSupabase();
    const bountyId = nanoid();
    const now = Math.floor(Date.now() / 1000);
    const reviewDeadline = (deadline as number) + 7 * 86400;

    const { error: insertError } = await supabase.from("bounties").insert({
      id: bountyId,
      title: (title as string).trim(),
      description: (description as string).trim(),
      panel_id: panelId,
      creator_user_id: creatorUserId,
      reward_amount: rewardAmount as number,
      escrow_tx_id: null,
      status: "open",
      awarded_submission_id: null,
      deadline: deadline as number,
      review_deadline: reviewDeadline,
      max_submissions: (maxSubmissions as number | undefined) ?? 10,
      difficulty_tier: (difficultyTier as DifficultyTier | undefined) ?? "moderate",
      evaluation_criteria: evaluationCriteria ? (evaluationCriteria as string).trim() : null,
      acceptance_criteria: parsedCriteria.length > 0 ? JSON.stringify(parsedCriteria) : "[]",
      tags: parsedTags.length > 0 ? parsedTags.join(",") : null,
      submission_count: 0,
      bid_count: 0,
      created_at: now,
      updated_at: null,
    });

    if (insertError) {
      return jsonResponse({ ok: false, error: "Failed to create bounty." }, 500);
    }

    notifyMatchingSubscribers({
      bountyId,
      panelId,
      difficultyTier: (difficultyTier as string | undefined) ?? "moderate",
      rewardAmount: rewardAmount as number,
      tags: parsedTags,
      title: (title as string).trim(),
    }).catch(() => {});

    return jsonResponse(
      {
        ok: true,
        data: {
          id: bountyId,
          title: (title as string).trim(),
          description: (description as string).trim(),
          panelId,
          creatorUserId,
          rewardAmount: rewardAmount as number,
          rewardDisplay: `$${((rewardAmount as number) / 100).toFixed(2)}`,
          status: "open",
          deadline: new Date((deadline as number) * 1000).toISOString(),
          maxSubmissions: (maxSubmissions as number | undefined) ?? 10,
          difficultyTier: (difficultyTier as string | undefined) ?? "moderate",
          evaluationCriteria: evaluationCriteria ? (evaluationCriteria as string).trim() : null,
          acceptanceCriteria: parsedCriteria,
          tags: parsedTags,
          submissionCount: 0,
          bidCount: 0,
          createdAt: new Date(now * 1000).toISOString(),
        },
      },
      201,
    );
  } catch {
    return jsonResponse({ ok: false, error: "Failed to create bounty." }, 500);
  }
}
