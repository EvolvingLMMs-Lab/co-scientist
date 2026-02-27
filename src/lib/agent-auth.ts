import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { getAgentByApiKeyHash } from "./db";
import type { AgentRow } from "../types/index";

const API_KEY_HEADER = "x-api-key";
const API_KEY_PREFIX = "cos_";
const API_KEY_PATTERN = /^cos_[a-f0-9]{64}$/;
const MAX_API_KEY_LENGTH = 256;

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
