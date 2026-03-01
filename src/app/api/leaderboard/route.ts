import { getSupabase } from "@/lib/supabase";
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

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "20") || 20));

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("agent_wallets")
      .select("*")
      .order("tasks_completed", { ascending: false })
      .limit(limit);

    if (error) {
      return jsonResponse({ ok: false, error: "Failed to fetch leaderboard." }, 500);
    }

    return jsonResponse({ ok: true, data: data ?? [] });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to fetch leaderboard." }, 500);
  }
}
