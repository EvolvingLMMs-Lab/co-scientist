import { getSupabase } from "@/lib/supabase";
import type { PublisherReputation } from "@/types/bounty";
import type { ApiResponse } from "@/types/index";

interface PublisherReputationRow {
  publisher_id: string;
  score: number;
  confidence: number;
  tier: PublisherReputation["tier"];
  bounties_posted: number;
  bounties_awarded: number;
  bounties_expired: number;
  total_rejections: number;
  disputes_received: number;
  disputes_lost: number;
  reviews_on_time: number;
  average_review_hours: number | null;
  total_credits_escrowed: number;
  total_credits_paid_out: number;
  updated_at: number;
}

function jsonResponse(
  body: ApiResponse<unknown>,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function toIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

function mapPublisherReputation(row: PublisherReputationRow): PublisherReputation {
  return {
    publisherId: row.publisher_id,
    score: row.score,
    confidence: row.confidence,
    tier: row.tier,
    bountiesPosted: row.bounties_posted,
    bountiesAwarded: row.bounties_awarded,
    bountiesExpired: row.bounties_expired,
    totalRejections: row.total_rejections,
    disputesReceived: row.disputes_received,
    disputesLost: row.disputes_lost,
    reviewsOnTime: row.reviews_on_time,
    averageReviewHours: row.average_review_hours,
    totalCreditsEscrowed: row.total_credits_escrowed,
    totalCreditsPaidOut: row.total_credits_paid_out,
    updatedAt: toIsoDate(row.updated_at),
  };
}

function getDefaultPublisherReputation(
  publisherId: string,
  nowEpochSeconds: number,
): PublisherReputation {
  return {
    publisherId,
    score: 60,
    confidence: 0,
    tier: "good",
    bountiesPosted: 0,
    bountiesAwarded: 0,
    bountiesExpired: 0,
    totalRejections: 0,
    disputesReceived: 0,
    disputesLost: 0,
    reviewsOnTime: 0,
    averageReviewHours: null,
    totalCreditsEscrowed: 0,
    totalCreditsPaidOut: 0,
    updatedAt: toIsoDate(nowEpochSeconds),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: publisherId } = await params;
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from("publisher_reputation")
      .select("*")
      .eq("publisher_id", publisherId)
      .maybeSingle();

    if (error) {
      return jsonResponse({ ok: false, error: "Failed to fetch publisher reputation." }, 500);
    }

    const now = Math.floor(Date.now() / 1000);
    const reputation = data
      ? mapPublisherReputation(data as PublisherReputationRow)
      : getDefaultPublisherReputation(publisherId, now);

    return jsonResponse({ ok: true, data: reputation });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to fetch publisher reputation." }, 500);
  }
}
