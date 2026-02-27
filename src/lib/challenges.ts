import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import {
  CHALLENGE_GENERATORS,
  CHALLENGE_TYPES,
  type ChallengeType,
} from "./challenge-generators";

export interface Challenge {
  id: string;
  type: ChallengeType;
  prompt: string;
  data: unknown;
  expectedAnswer: string;
  createdAt: number;
  expiresAt: number;
}

export interface PublicChallenge {
  challengeId: string;
  type: ChallengeType;
  prompt: string;
  data: unknown;
  expiresIn: number;
}

export interface ChallengeValidationResult {
  valid: boolean;
  reason: string;
  solveTimeMs?: number;
  challengeId?: string;
  challengeType?: ChallengeType;
}

interface VerificationTokenHeader {
  alg: "HS256";
  typ: "JWT";
}

export interface VerificationTokenClaims {
  iss: "co-scientist";
  sub: "inverse-captcha";
  jti: string;
  iat: number;
  exp: number;
  challengeId: string;
  challengeType: ChallengeType;
}

export interface VerificationTokenValidationResult {
  valid: boolean;
  reason: string;
  payload?: VerificationTokenClaims;
}

export const CHALLENGE_RESPONSE_WINDOW_MS = 5_000;
export const CHALLENGE_NETWORK_TOLERANCE_MS = 500;
export const VERIFICATION_TOKEN_TTL_SECONDS = 5 * 60;

const CHALLENGE_STORE_TTL_MS = 30_000;
const CLEANUP_INTERVAL_MS = 5_000;

const activeChallenges = new Map<string, Challenge>();
const activeVerificationTokenIds = new Map<string, number>();

const verificationTokenSecret =
  process.env.CHALLENGE_TOKEN_SECRET?.trim() || randomBytes(32).toString("hex");

let cleanupInitialized = false;

function createId(length = 21): string {
  return randomBytes(length).toString("base64url").slice(0, length);
}

function cleanupExpiredState(now = Date.now()): void {
  for (const [challengeId, challenge] of activeChallenges.entries()) {
    if (now - challenge.createdAt > CHALLENGE_STORE_TTL_MS) {
      activeChallenges.delete(challengeId);
    }
  }

  for (const [tokenId, expiresAtMs] of activeVerificationTokenIds.entries()) {
    if (expiresAtMs <= now) {
      activeVerificationTokenIds.delete(tokenId);
    }
  }
}

function ensureCleanupLoop(): void {
  if (cleanupInitialized) {
    return;
  }

  cleanupInitialized = true;
  const timer = setInterval(() => {
    cleanupExpiredState();
  }, CLEANUP_INTERVAL_MS);

  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

function normalizeIntegerAnswer(answer: string): string {
  const trimmed = answer.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && Number.isInteger(asNumber)) {
    return String(asNumber);
  }

  return trimmed;
}

function normalizeRegexAnswer(answer: string): string {
  const trimmed = answer.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const lowered = trimmed.toLowerCase();
  if (lowered === "none" || lowered === "[]") {
    return "none";
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed) && parsed.every((value) => Number.isInteger(value))) {
        const normalized = [...new Set(parsed as number[])].sort((a, b) => a - b);
        return normalized.join(",");
      }
    } catch {
      return trimmed;
    }
  }

  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return "";
  }

  const parsedIndices = parts.map((part) => Number(part));
  if (parsedIndices.every((index) => Number.isInteger(index))) {
    const normalized = [...new Set(parsedIndices)].sort((a, b) => a - b);
    return normalized.join(",");
  }

  return parts.join(",");
}

function normalizeJsonAnswer(answer: string): string {
  const trimmed = answer.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function normalizeChallengeAnswer(answer: string, challengeType: ChallengeType): string {
  switch (challengeType) {
    case "crypto":
      return answer.trim().toLowerCase();
    case "code":
    case "math":
    case "pattern":
    case "matrix":
      return normalizeIntegerAnswer(answer);
    case "json":
      return normalizeJsonAnswer(answer);
    case "regex":
      return normalizeRegexAnswer(answer);
    default:
      return answer.trim();
  }
}

function logValidation(
  challenge: Challenge,
  solveTimeMs: number,
  valid: boolean,
  reason: string,
): void {
  console.info("[inverse-captcha] validation", {
    challengeId: challenge.id,
    challengeType: challenge.type,
    solveTimeMs,
    valid,
    reason,
  });
}

function base64UrlEncodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function base64UrlDecodeJson<T>(segment: string): T | null {
  try {
    const decoded = Buffer.from(segment, "base64url").toString("utf8");
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

function signTokenValue(value: string): string {
  return createHmac("sha256", verificationTokenSecret).update(value).digest("base64url");
}

function signaturesMatch(receivedSignature: string, expectedSignature: string): boolean {
  const receivedBuffer = Buffer.from(receivedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

function isChallengeType(value: unknown): value is ChallengeType {
  return typeof value === "string" && CHALLENGE_TYPES.includes(value as ChallengeType);
}

function isVerificationTokenClaims(value: unknown): value is VerificationTokenClaims {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const claims = value as Partial<VerificationTokenClaims>;
  return (
    claims.iss === "co-scientist" &&
    claims.sub === "inverse-captcha" &&
    typeof claims.jti === "string" &&
    typeof claims.iat === "number" &&
    typeof claims.exp === "number" &&
    typeof claims.challengeId === "string" &&
    isChallengeType(claims.challengeType)
  );
}

function parseAndVerifyToken(token: string): VerificationTokenValidationResult {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "invalid token format" };
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const expectedSignature = signTokenValue(`${headerPart}.${payloadPart}`);

  if (!signaturesMatch(signaturePart, expectedSignature)) {
    return { valid: false, reason: "invalid token signature" };
  }

  const header = base64UrlDecodeJson<VerificationTokenHeader>(headerPart);
  if (!header || header.alg !== "HS256" || header.typ !== "JWT") {
    return { valid: false, reason: "invalid token header" };
  }

  const claims = base64UrlDecodeJson<unknown>(payloadPart);
  if (!isVerificationTokenClaims(claims)) {
    return { valid: false, reason: "invalid token payload" };
  }

  if (!activeVerificationTokenIds.has(claims.jti)) {
    return { valid: false, reason: "token already used or unknown" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (claims.exp <= nowSeconds) {
    activeVerificationTokenIds.delete(claims.jti);
    return { valid: false, reason: "token expired" };
  }

  return { valid: true, reason: "ok", payload: claims };
}

export function toPublicChallenge(challenge: Challenge): PublicChallenge {
  return {
    challengeId: challenge.id,
    type: challenge.type,
    prompt: challenge.prompt,
    data: challenge.data,
    expiresIn: CHALLENGE_RESPONSE_WINDOW_MS,
  };
}

export function generateChallenge(): Challenge {
  ensureCleanupLoop();
  cleanupExpiredState();

  const type = CHALLENGE_TYPES[randomInt(0, CHALLENGE_TYPES.length)];
  const generated = CHALLENGE_GENERATORS[type]();

  const createdAt = Date.now();
  const challenge: Challenge = {
    id: createId(),
    type,
    prompt: generated.prompt,
    data: generated.data,
    expectedAnswer: normalizeChallengeAnswer(generated.expectedAnswer, type),
    createdAt,
    expiresAt: createdAt + CHALLENGE_RESPONSE_WINDOW_MS,
  };

  activeChallenges.set(challenge.id, challenge);
  return challenge;
}

export function validateChallengeResponse(
  challengeId: string,
  answer: string,
  respondedAt: number,
): ChallengeValidationResult {
  ensureCleanupLoop();
  cleanupExpiredState();

  const challenge = activeChallenges.get(challengeId);
  if (!challenge) {
    return { valid: false, reason: "expired" };
  }

  if (!Number.isFinite(respondedAt)) {
    activeChallenges.delete(challengeId);
    return { valid: false, reason: "invalid timing" };
  }

  if (respondedAt - challenge.createdAt > CHALLENGE_STORE_TTL_MS) {
    activeChallenges.delete(challengeId);
    return { valid: false, reason: "expired" };
  }

  const solveTimeMs = Math.round(respondedAt - challenge.createdAt);

  if (solveTimeMs < 0) {
    activeChallenges.delete(challengeId);
    logValidation(challenge, solveTimeMs, false, "invalid timing");
    return { valid: false, reason: "invalid timing", solveTimeMs };
  }

  const maxAllowedMs = CHALLENGE_RESPONSE_WINDOW_MS + CHALLENGE_NETWORK_TOLERANCE_MS;
  if (
    solveTimeMs > maxAllowedMs ||
    respondedAt > challenge.expiresAt + CHALLENGE_NETWORK_TOLERANCE_MS
  ) {
    activeChallenges.delete(challengeId);
    logValidation(challenge, solveTimeMs, false, "too slow");
    return { valid: false, reason: "too slow", solveTimeMs };
  }

  const normalizedAnswer = normalizeChallengeAnswer(answer, challenge.type);
  if (normalizedAnswer !== challenge.expectedAnswer) {
    activeChallenges.delete(challengeId);
    logValidation(challenge, solveTimeMs, false, "wrong answer");
    return { valid: false, reason: "wrong answer", solveTimeMs };
  }

  activeChallenges.delete(challengeId);
  logValidation(challenge, solveTimeMs, true, "ok");

  return {
    valid: true,
    reason: "ok",
    solveTimeMs,
    challengeId: challenge.id,
    challengeType: challenge.type,
  };
}

export function createVerificationToken(payload: {
  challengeId: string;
  challengeType: ChallengeType;
}): string {
  ensureCleanupLoop();
  cleanupExpiredState();

  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims: VerificationTokenClaims = {
    iss: "co-scientist",
    sub: "inverse-captcha",
    jti: createId(),
    iat: nowSeconds,
    exp: nowSeconds + VERIFICATION_TOKEN_TTL_SECONDS,
    challengeId: payload.challengeId,
    challengeType: payload.challengeType,
  };

  const header: VerificationTokenHeader = {
    alg: "HS256",
    typ: "JWT",
  };

  const headerPart = base64UrlEncodeJson(header);
  const payloadPart = base64UrlEncodeJson(claims);
  const signaturePart = signTokenValue(`${headerPart}.${payloadPart}`);

  activeVerificationTokenIds.set(claims.jti, claims.exp * 1000);

  return `${headerPart}.${payloadPart}.${signaturePart}`;
}

export function verifyVerificationToken(token: string): VerificationTokenValidationResult {
  ensureCleanupLoop();
  cleanupExpiredState();

  if (typeof token !== "string" || token.trim().length === 0) {
    return { valid: false, reason: "missing token" };
  }

  return parseAndVerifyToken(token.trim());
}

export function consumeVerificationToken(token: string): VerificationTokenValidationResult {
  const validation = verifyVerificationToken(token);
  if (!validation.valid || !validation.payload) {
    return validation;
  }

  activeVerificationTokenIds.delete(validation.payload.jti);
  return validation;
}
