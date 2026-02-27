import {
  createVerificationToken,
  generateChallenge,
  toPublicChallenge,
  validateChallengeResponse,
} from "@/lib/challenges";
import type { ApiResponse } from "@/types/index";

interface ChallengeIssueResponse {
  challengeId: string;
  type: string;
  prompt: string;
  data: unknown;
  expiresIn: number;
}

interface ChallengeVerifyResponse {
  verified: true;
  verificationToken: string;
}

interface ChallengeSubmissionBody {
  challengeId: string;
  answer: string;
}

function jsonResponse<T>(
  body: ApiResponse<T>,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  responseHeaders.set("Cache-Control", "no-store");

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function parseChallengeSubmission(body: unknown):
  | { ok: true; data: ChallengeSubmissionBody }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const payload = body as Record<string, unknown>;
  const challengeId = typeof payload.challengeId === "string" ? payload.challengeId.trim() : "";
  if (!challengeId) {
    return { ok: false, error: "challengeId is required." };
  }

  const answerRaw = payload.answer;
  if (
    typeof answerRaw !== "string" &&
    typeof answerRaw !== "number" &&
    typeof answerRaw !== "boolean"
  ) {
    return { ok: false, error: "answer must be a string, number, or boolean." };
  }

  return {
    ok: true,
    data: {
      challengeId,
      answer: String(answerRaw),
    },
  };
}

function statusCodeForReason(reason: string): number {
  if (reason === "too slow") {
    return 408;
  }

  if (reason === "expired") {
    return 410;
  }

  return 400;
}

export async function GET(): Promise<Response> {
  const challenge = generateChallenge();
  const publicChallenge = toPublicChallenge(challenge);

  return jsonResponse<ChallengeIssueResponse>(
    {
      ok: true,
      data: {
        challengeId: publicChallenge.challengeId,
        type: publicChallenge.type,
        prompt: publicChallenge.prompt,
        data: publicChallenge.data,
        expiresIn: publicChallenge.expiresIn,
      },
    },
    200,
  );
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Invalid JSON body.",
      },
      400,
    );
  }

  const parsed = parseChallengeSubmission(body);
  if (!parsed.ok) {
    return jsonResponse(
      {
        ok: false,
        error: parsed.error,
      },
      400,
    );
  }

  const validation = validateChallengeResponse(
    parsed.data.challengeId,
    parsed.data.answer,
    Date.now(),
  );

  if (!validation.valid) {
    return jsonResponse(
      {
        ok: false,
        error: validation.reason,
      },
      statusCodeForReason(validation.reason),
    );
  }

  if (!validation.challengeId || !validation.challengeType) {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to issue verification token.",
      },
      500,
    );
  }

  const verificationToken = createVerificationToken({
    challengeId: validation.challengeId,
    challengeType: validation.challengeType,
  });

  return jsonResponse<ChallengeVerifyResponse>(
    {
      ok: true,
      data: {
        verified: true,
        verificationToken,
      },
    },
    200,
  );
}
