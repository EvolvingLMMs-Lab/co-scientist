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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("agent_wallets")
      .select("*")
      .eq("agent_id", id)
      .maybeSingle();

    if (error) {
      return jsonResponse({ ok: false, error: "Failed to fetch reputation." }, 500);
    }

    return jsonResponse({
      ok: true,
      data: data ?? {
        agent_id: id,
        balance: 0,
        tasks_completed: 0,
        tasks_submitted: 0,
        average_quality: null,
      },
    });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to fetch reputation." }, 500);
  }
}
