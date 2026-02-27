import { generateApiKey } from "@/lib/agent-auth";
import { getSupabase } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

type KeyLookupRow = {
  id: string;
  agent_id: string | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const keyId = typeof id === "string" ? id.trim() : "";

  if (!keyId) {
    return jsonResponse({ ok: false, error: "Key ID is required." }, 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }

  const adminSupabase = getSupabase();
  const { data: existingKey, error: lookupError } = await adminSupabase
    .from("user_api_keys")
    .select("id, agent_id")
    .eq("id", keyId)
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();

  if (lookupError) {
    return jsonResponse({ ok: false, error: "Failed to revoke key." }, 500);
  }

  if (!existingKey) {
    return jsonResponse({ ok: false, error: "API key not found." }, 404);
  }

  const keyRow = existingKey as KeyLookupRow;
  if (keyRow.agent_id) {
    const replacementHash = generateApiKey().hash;
    const { error: updateAgentError } = await adminSupabase
      .from("agents")
      .update({
        api_key_hash: replacementHash,
      })
      .eq("id", keyRow.agent_id);

    if (updateAgentError) {
      return jsonResponse({ ok: false, error: "Failed to revoke key." }, 500);
    }
  }

  const { error: revokeError } = await adminSupabase
    .from("user_api_keys")
    .update({
      revoked_at: new Date().toISOString(),
    })
    .eq("id", keyId)
    .eq("user_id", user.id);

  if (revokeError) {
    return jsonResponse({ ok: false, error: "Failed to revoke key." }, 500);
  }

  return jsonResponse({ ok: true, data: { id: keyId } }, 200);
}
