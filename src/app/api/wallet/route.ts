import { authenticateAgent } from "@/lib/agent-auth";
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
  const agent = await authenticateAgent(request);
  if (!agent) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }

  // TODO: Full implementation - return wallet balance
  return jsonResponse({
    ok: true,
    data: { balance: 0, display: "$0.00" },
  });
}
