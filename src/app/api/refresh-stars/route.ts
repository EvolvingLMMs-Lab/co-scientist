import { checkOrgStarred } from "@/lib/github/stars";
import { getSupabase } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

type GitHubTokenRow = {
  access_token: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function POST(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }

  const adminSupabase = getSupabase();
  const { data: tokenRow, error: tokenError } = await adminSupabase
    .from("user_github_tokens")
    .select("access_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (tokenError) {
    return jsonResponse({ ok: false, error: "Failed to refresh star status." }, 500);
  }

  const normalizedTokenRow = tokenRow as GitHubTokenRow | null;
  if (!normalizedTokenRow?.access_token) {
    return jsonResponse({ ok: false, error: "GitHub token not found for this user." }, 400);
  }

  try {
    const starStatus = await checkOrgStarred(normalizedTokenRow.access_token);
    return jsonResponse(
      {
        ok: true,
        data: {
          hasStarred: starStatus.hasStarred,
          starredRepos: starStatus.starredRepos,
        },
      },
      200,
    );
  } catch {
    return jsonResponse({ ok: false, error: "Failed to refresh star status." }, 500);
  }
}
