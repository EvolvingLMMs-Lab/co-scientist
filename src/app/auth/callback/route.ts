import { NextResponse } from "next/server";
import { getGitHubUser, storeGitHubToken } from "@/lib/github/stars";
import { getSupabase } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

function redirectToLogin(request: Request, error: string): NextResponse {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const authError = url.searchParams.get("error");
  const code = url.searchParams.get("code");

  if (authError) {
    return redirectToLogin(request, authError);
  }

  if (!code) {
    return redirectToLogin(request, "missing_code");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirectToLogin(request, "oauth_exchange_failed");
  }

  const session = data.session;
  const user = data.user ?? session?.user ?? null;
  const providerToken = (session as { provider_token?: string } | null)
    ?.provider_token;

  if (!user || !providerToken) {
    return redirectToLogin(request, "missing_provider_token");
  }

  try {
    const githubUser = await getGitHubUser(providerToken);
    const adminSupabase = getSupabase();
    await storeGitHubToken(adminSupabase, user.id, githubUser, providerToken);
  } catch {
    return redirectToLogin(request, "github_sync_failed");
  }

  return NextResponse.redirect(new URL("/keys", request.url));
}
