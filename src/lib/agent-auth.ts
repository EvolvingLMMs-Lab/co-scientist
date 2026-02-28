import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { getAgentByApiKeyHash } from "./db";
import { getSupabase } from "./supabase";
import { createClient } from "./supabase/server";
import type { AgentRow } from "../types/index";

const API_KEY_HEADER = "x-api-key";
const API_KEY_PREFIX = "cos_";
const API_KEY_PATTERN = /^cos_[a-f0-9]{64}$/;
const MAX_API_KEY_LENGTH = 256;

type UserApiKeyAgentRow = {
  agent_id: string | null;
};

function normalizeApiKey(rawKey: string | null): string | null {
  if (rawKey === null) {
    return null;
  }

  const normalized = rawKey.trim();
  if (!normalized || normalized.length > MAX_API_KEY_LENGTH) {
    return null;
  }

  return normalized;
}

function extractApiKey(request: Request): string | null {
  return normalizeApiKey(request.headers.get(API_KEY_HEADER));
}

function isWellFormedAgentKey(apiKey: string): boolean {
  return API_KEY_PATTERN.test(apiKey);
}

function secureCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getUnauthorizedResponse(message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": 'ApiKey realm="co-scientist"',
    },
  });
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(
  randomBytesFn: (size: number) => Buffer = randomBytes,
): { key: string; hash: string } {
  const randomPart = randomBytesFn(32).toString("hex");
  const key = `${API_KEY_PREFIX}${randomPart}`;

  return {
    key,
    hash: hashApiKey(key),
  };
}

export async function authenticateAgent(
  request: Request,
): Promise<AgentRow | null> {
  const apiKey = extractApiKey(request);
  if (!apiKey || !isWellFormedAgentKey(apiKey)) {
    return null;
  }

  try {
    const apiKeyHash = hashApiKey(apiKey);
    const agent = await Promise.resolve(getAgentByApiKeyHash(apiKeyHash));
    return agent;
  } catch {
    return null;
  }
}

async function getCurrentOperatorUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

async function getOperatorOwnedAgentId(
  userId: string,
  preferredAgentId?: string,
): Promise<string | null> {
  try {
    const supabase = getSupabase();
    let query = supabase
      .from("user_api_keys")
      .select("agent_id, created_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .not("agent_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (preferredAgentId) {
      query = query.eq("agent_id", preferredAgentId);
    }

    const { data, error } = await query;
    if (error) {
      return null;
    }

    const row = ((data ?? []) as UserApiKeyAgentRow[])[0];
    return row?.agent_id ?? null;
  } catch {
    return null;
  }
}

async function getAgentById(agentId: string): Promise<AgentRow | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return data as AgentRow;
  } catch {
    return null;
  }
}

export async function isCurrentOperatorForAgent(agentId: string): Promise<boolean> {
  if (!agentId.trim()) {
    return false;
  }

  const userId = await getCurrentOperatorUserId();
  if (!userId) {
    return false;
  }

  const ownedAgentId = await getOperatorOwnedAgentId(userId, agentId);
  return ownedAgentId === agentId;
}

export async function authenticateAgentOrOperator(
  request: Request,
  preferredAgentId?: string,
): Promise<AgentRow | null> {
  const directAgent = await authenticateAgent(request);
  if (directAgent) {
    return directAgent;
  }

  const userId = await getCurrentOperatorUserId();
  if (!userId) {
    return null;
  }

  const ownedAgentId = await getOperatorOwnedAgentId(userId, preferredAgentId);
  if (!ownedAgentId) {
    return null;
  }

  return getAgentById(ownedAgentId);
}

export function isAdmin(request: Request): boolean {
  const apiKey = extractApiKey(request);
  const adminApiKey = normalizeApiKey(process.env.ADMIN_API_KEY ?? null);

  if (!apiKey || !adminApiKey) {
    return false;
  }

  return secureCompare(apiKey, adminApiKey);
}

export async function requireAgent(
  request: Request,
): Promise<{ agent: AgentRow } | { error: Response }> {
  const apiKey = extractApiKey(request);

  if (!apiKey) {
    return { error: getUnauthorizedResponse("Missing X-API-Key header.") };
  }

  if (!isWellFormedAgentKey(apiKey)) {
    return {
      error: getUnauthorizedResponse(
        "Malformed API key. Expected a key with the cos_ prefix.",
      ),
    };
  }

  const agent = await authenticateAgent(request);
  if (!agent) {
    return { error: getUnauthorizedResponse("Invalid API key or unknown agent.") };
  }

  return { agent };
}
