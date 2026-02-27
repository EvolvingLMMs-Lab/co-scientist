import type { SupabaseClient } from "@supabase/supabase-js";
import { GITHUB_CONFIG } from "./config";

const GITHUB_API_BASE = "https://api.github.com";

type GitHubRepo = {
  name: string;
};

export type GitHubUser = {
  id: number;
  login: string;
  avatar_url: string | null;
};

export type GitHubStarCheckResult = {
  hasStarred: boolean;
  starredRepos: string[];
};

function buildHeaders(accessToken?: string): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "co-scientist",
  };

  if (accessToken) {
    return {
      ...headers,
      Authorization: `Bearer ${accessToken}`,
    };
  }

  return headers;
}

export async function getGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch(`${GITHUB_API_BASE}/user`, {
    method: "GET",
    headers: buildHeaders(accessToken),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub user (${response.status})`);
  }

  const user = (await response.json()) as {
    id: number;
    login: string;
    avatar_url?: string | null;
  };

  return {
    id: user.id,
    login: user.login,
    avatar_url: user.avatar_url ?? null,
  };
}

export async function checkOrgStarred(
  accessToken: string,
): Promise<GitHubStarCheckResult> {
  if (!accessToken) {
    return {
      hasStarred: false,
      starredRepos: [],
    };
  }

  const repoListHeaders = buildHeaders(process.env.GITHUB_TOKEN);
  const reposResponse = await fetch(
    `${GITHUB_API_BASE}/orgs/${GITHUB_CONFIG.ORG}/repos?sort=stars&per_page=30`,
    {
      method: "GET",
      headers: repoListHeaders,
      cache: "no-store",
    },
  );

  if (!reposResponse.ok) {
    throw new Error(`Failed to fetch org repositories (${reposResponse.status})`);
  }

  const repos = (await reposResponse.json()) as GitHubRepo[];
  const starredRepos: string[] = [];

  for (const repo of repos) {
    const starResponse = await fetch(
      `${GITHUB_API_BASE}/user/starred/${GITHUB_CONFIG.ORG}/${repo.name}`,
      {
        method: "GET",
        headers: buildHeaders(accessToken),
        cache: "no-store",
      },
    );

    if (starResponse.status === 204) {
      starredRepos.push(repo.name);
      continue;
    }

    if (starResponse.status === 404) {
      continue;
    }

    throw new Error(`Failed to check starred repo (${starResponse.status})`);
  }

  return {
    hasStarred: starredRepos.length >= GITHUB_CONFIG.REQUIRED_STARS,
    starredRepos,
  };
}

export async function storeGitHubToken(
  supabase: SupabaseClient,
  userId: string,
  githubUser: GitHubUser,
  accessToken: string,
): Promise<void> {
  const { error } = await supabase.from("user_github_tokens").upsert(
    {
      user_id: userId,
      github_id: githubUser.id,
      github_username: githubUser.login,
      github_avatar_url: githubUser.avatar_url,
      access_token: accessToken,
      token_scope: null,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id",
    },
  );

  if (error) {
    throw new Error(`Failed to store GitHub token: ${error.message}`);
  }
}
