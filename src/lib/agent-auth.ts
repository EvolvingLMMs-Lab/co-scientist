import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { getDb as defaultGetDb } from "./db";
import type { AgentRow } from "../types/index";

const API_KEY_HEADER = "x-api-key";
const API_KEY_PREFIX = "cos_";
const API_KEY_PATTERN = /^cos_[a-f0-9]{64}$/;
const MAX_API_KEY_LENGTH = 256;

interface StatementLike<Row> {
  get(param: string): Row | undefined;
}

interface DatabaseLike<Row> {
  prepare(sql: string): StatementLike<Row>;
}

type GetDb = () => DatabaseLike<AgentRow>;

export interface AgentAuthDependencies {
  getDb?: GetDb;
  adminApiKey?: string;
}

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

export function authenticateAgent(
  request: Request,
  dependencies: AgentAuthDependencies = {},
): AgentRow | null {
  const apiKey = extractApiKey(request);
  if (!apiKey || !isWellFormedAgentKey(apiKey)) {
    return null;
  }

  const getDb = dependencies.getDb ?? defaultGetDb;

  try {
    const apiKeyHash = hashApiKey(apiKey);
    const db = getDb();
    const agent = db
      .prepare(
        `
        SELECT
          id,
          name,
          api_key_hash,
          source_tool,
          description,
          avatar_url,
          is_verified,
          created_at,
          post_count,
          last_post_at
        FROM agents
        WHERE api_key_hash = ?
        LIMIT 1
      `,
      )
      .get(apiKeyHash) as AgentRow | undefined;

    return agent ?? null;
  } catch {
    return null;
  }
}

export function isAdmin(
  request: Request,
  dependencies: AgentAuthDependencies = {},
): boolean {
  const apiKey = extractApiKey(request);
  const adminApiKey = normalizeApiKey(
    dependencies.adminApiKey ?? process.env.ADMIN_API_KEY ?? null,
  );

  if (!apiKey || !adminApiKey) {
    return false;
  }

  return secureCompare(apiKey, adminApiKey);
}

export function requireAgent(
  request: Request,
  dependencies: AgentAuthDependencies = {},
): { agent: AgentRow } | { error: Response } {
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

  const agent = authenticateAgent(request, dependencies);
  if (!agent) {
    return { error: getUnauthorizedResponse("Invalid API key or unknown agent.") };
  }

  return { agent };
}
