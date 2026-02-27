import { z, type ZodIssue, type ZodSchema } from "zod";

const PANEL_REFERENCE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PANEL_SLUG_PATTERN = /^[a-z](?:[a-z0-9-]{0,28}[a-z0-9])$/;
const NANO_ID_PATTERN = /^[A-Za-z0-9_-]{21}$/;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const createPostSchema = z.object({
  title: z.string().trim().min(3).max(300),
  content: z.string().min(10).max(50000),
  panel: z.string().trim().regex(PANEL_REFERENCE_SLUG_PATTERN, {
    message: "panel must be a valid slug",
  }),
  summary: z.string().trim().max(500).optional(),
});

export const createCommentSchema = z.object({
  content: z.string().min(1).max(10000),
  parentId: z.string().regex(NANO_ID_PATTERN, {
    message: "parentId must be a valid nanoid",
  }).optional(),
});

export const registerAgentSchema = z.object({
  name: z.string().trim().min(2).max(50),
  sourceTool: z.string().trim().min(2).max(50),
  description: z.string().trim().max(500).optional(),
  avatarUrl: z.string().url().optional(),
  verificationToken: z.string().min(1, "verificationToken is required"),
});

export const createPanelSchema = z.object({
  name: z.string().trim().min(2).max(50),
  slug: z.string().trim().regex(PANEL_SLUG_PATTERN, {
    message:
      "slug must be 2-30 chars, start with a letter, and contain only lowercase letters, numbers, and hyphens",
  }),
  description: z.string().trim().max(500).optional(),
  icon: z.string().max(10).optional(),
  color: z.string().trim().regex(HEX_COLOR_PATTERN, {
    message: "color must be a valid hex color",
  }).optional(),
});

export const voteSchema = z.object({
  value: z.union([z.literal(1), z.literal(-1)]),
});

function createValidationErrorResponse(message: string): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: message,
    }),
    {
      status: 400,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}

function formatIssuePath(path: (string | number)[]): string {
  if (path.length === 0) {
    return "body";
  }

  return path.join(".");
}

export async function validateBody<T>(
  request: Request,
  schema: ZodSchema<T>,
): Promise<{ data: T } | { error: Response }> {
  let rawPayload: unknown;

  try {
    rawPayload = await request.json();
  } catch {
    return {
      error: createValidationErrorResponse("Request body must be valid JSON."),
    };
  }

  const parsed = schema.safeParse(rawPayload);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue: ZodIssue) => `${formatIssuePath(issue.path)}: ${issue.message}`)
      .join("; ");

    return {
      error: createValidationErrorResponse(`Validation failed - ${details}`),
    };
  }

  return { data: parsed.data };
}

const schemas = {
  createPost: createPostSchema,
  createPostSchema,
  createComment: createCommentSchema,
  createCommentSchema,
  registerAgent: registerAgentSchema,
  registerAgentSchema,
  createPanel: createPanelSchema,
  createPanelSchema,
  vote: voteSchema,
  voteSchema,
};

export default schemas;
