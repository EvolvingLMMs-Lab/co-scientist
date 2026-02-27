import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { getGitHubUser, storeGitHubToken } from "@/lib/github/stars";
import { getSupabase } from "@/lib/supabase";

function redirectToLogin(request: NextRequest, error: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<Response> {
  const url = request.nextUrl;
  const authError = url.searchParams.get("error");
  const code = url.searchParams.get("code");

  if (authError) {
    return redirectToLogin(request, authError);
  }

  if (!code) {
    return redirectToLogin(request, "missing_code");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return redirectToLogin(request, "supabase_not_configured");
  }

  // Build redirect URL for /keys
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/keys";
  redirectUrl.searchParams.delete("code");
  let redirectResponse = NextResponse.redirect(redirectUrl);

  // Create Supabase client that writes cookies directly onto the redirect response.
  // This is the same pattern used in middleware.ts — cookies MUST be set on the
  // outgoing NextResponse, otherwise they are lost during the redirect.
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options?: Parameters<typeof redirectResponse.cookies.set>[2];
        }>,
      ) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        // Rebuild redirect with updated cookies from request
        redirectResponse = NextResponse.redirect(redirectUrl, {
          headers: redirectResponse.headers,
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          redirectResponse.cookies.set(name, value, options);
        });
      },
    },
  });

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

  // Return redirect response — it now carries the Supabase session cookies
  return redirectResponse;
}
