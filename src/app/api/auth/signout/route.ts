import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    return jsonResponse({ ok: false, error: "Failed to sign out." }, 500);
  }

  return NextResponse.redirect(new URL("/", request.url));
}
