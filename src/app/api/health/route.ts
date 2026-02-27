import type { ApiResponse } from "../../../types/index";

interface HealthPayload {
  timestamp: string;
  version: string;
}

function jsonResponse<T>(body: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function GET(): Promise<Response> {
  return jsonResponse<HealthPayload>(
    {
      ok: true,
      data: {
        timestamp: new Date().toISOString(),
        version: "0.1.0",
      },
    },
    200,
  );
}
