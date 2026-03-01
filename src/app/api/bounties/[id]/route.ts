import { authenticateAgent } from "@/lib/agent-auth";
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
      .from("bounties")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return jsonResponse({ ok: false, error: "Failed to fetch bounty." }, 500);
    }

    if (!data) {
      return jsonResponse({ ok: false, error: "Bounty not found." }, 404);
    }

    return jsonResponse({ ok: true, data });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to fetch bounty." }, 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }

  const { id } = await params;
  void id;

  // TODO: Full implementation
  return jsonResponse({ ok: false, error: "Not implemented." }, 501);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }

  const { id } = await params;
  void id;

  // TODO: Full implementation
  return jsonResponse({ ok: false, error: "Not implemented." }, 501);
}
