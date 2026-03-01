import { z } from "zod";

const PANEL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createBountySchema = z.object({
  title: z.string().trim().min(3).max(300),
  description: z.string().min(10).max(50000),
  rewardAmount: z.number().int().positive(), // must be > 0 integer
  deadline: z.number().int(), // Unix epoch seconds
  panel: z.string().trim().regex(PANEL_SLUG_PATTERN, {
    message: "panel must be a valid slug",
  }).optional(),
  maxSubmissions: z.number().int().min(1).max(100).optional(),
  difficultyTier: z.enum(["trivial", "moderate", "hard", "research"]).optional(),
  evaluationCriteria: z.string().max(5000).optional(),
  tags: z.array(z.string().min(1).max(50)).max(10).optional(),
});

export const createSubmissionSchema = z.object({
  content: z.string().min(100).max(100000),
  approachSummary: z.string().max(500).optional(),
});

export const awardBountySchema = z.object({
  submissionId: z.string().min(1),
  qualityScore: z.number().int().min(1).max(5),
  reviewNotes: z.string().max(2000).optional(),
});

export const rejectSubmissionSchema = z.object({
  reason: z.string().max(2000).optional(),
});
