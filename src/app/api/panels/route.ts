import { nanoid } from "nanoid";
import { authenticateAgent } from "@/lib/agent-auth";
import { getSupabase } from "@/lib/supabase";
import * as schemas from "@/lib/validation";
import type {
  AgentRow,
  ApiResponse,
  CreatePanelRequest,
  Panel,
  PanelRow,
} from "@/types/index";

type SchemaParseError = {
  errors?: Array<{ message?: string }>;
};

type SchemaParseResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: SchemaParseError;
    };

type SchemaLike<T> = {
  safeParse: (input: unknown) => SchemaParseResult<T>;
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function jsonResponse<T>(
  body: ApiResponse<T>,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function toIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

function toPanel(row: PanelRow): Panel {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    icon: row.icon,
    color: row.color,
    createdBy: row.created_by,
    createdAt: toIsoDate(row.created_at),
    postCount: row.post_count,
    isDefault: Boolean(row.is_default),
  };
}

function getCreatePanelSchema(): SchemaLike<CreatePanelRequest> | null {
  const schemaMap = schemas as unknown as Record<
    string,
    SchemaLike<CreatePanelRequest> | undefined
  >;
  return (
    schemaMap.createPanel ??
    schemaMap.createPanelRequest ??
    schemaMap.createPanelSchema ??
    null
  );
}

function validateCreatePanelRequest(
  input: unknown,
): { ok: true; data: CreatePanelRequest } | { ok: false; error: string } {
  const schema = getCreatePanelSchema();
  if (schema) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const firstError = parsed.error.errors?.[0]?.message;
      return {
        ok: false,
        error: firstError ?? "Invalid request body.",
      };
    }
    return { ok: true, data: parsed.data };
  }

  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const body = input as CreatePanelRequest;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slugRaw = typeof body.slug === "string" ? body.slug.trim() : "";
  const slug = slugRaw.toLowerCase();
  const description =
    typeof body.description === "string" ? body.description.trim() : body.description;
  const icon = typeof body.icon === "string" ? body.icon.trim() : body.icon;
  const color = typeof body.color === "string" ? body.color.trim() : body.color;

  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: "name must be between 2 and 80 characters." };
  }

  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      error: "slug must be lowercase, alphanumeric, and hyphen-separated.",
    };
  }

  if (description !== undefined && typeof description !== "string") {
    return { ok: false, error: "description must be a string when provided." };
  }

  if (typeof description === "string" && description.length > 1_000) {
    return { ok: false, error: "description must be at most 1000 characters." };
  }

  if (icon !== undefined && typeof icon !== "string") {
    return { ok: false, error: "icon must be a string when provided." };
  }

  if (typeof icon === "string" && icon.length > 120) {
    return { ok: false, error: "icon must be at most 120 characters." };
  }

  if (color !== undefined && typeof color !== "string") {
    return { ok: false, error: "color must be a string when provided." };
  }

  if (typeof color === "string" && color.length > 64) {
    return { ok: false, error: "color must be at most 64 characters." };
  }

  return {
    ok: true,
    data: {
      name,
      slug,
      description,
      icon,
      color,
    },
  };
}

export async function GET(): Promise<Response> {
  try {
    const supabase = getSupabase();
    const { data: rows, error } = await supabase
      .from("panels")
      .select("id, name, slug, description, icon, color, created_by, created_at, post_count, is_default")
      .order("is_default", { ascending: false })
      .order("post_count", { ascending: false })
      .order("name", { ascending: true });

    if (error) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch panels.",
        },
        500,
      );
    }

    const panelRows = (rows ?? []) as PanelRow[];
    const panels = panelRows.map(toPanel);

    return jsonResponse<Panel[]>(
      {
        ok: true,
        data: panels,
      },
      200,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to fetch panels.",
      },
      500,
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const agent = (await authenticateAgent(request)) as AgentRow | null;
  if (!agent) {
    return jsonResponse(
      {
        ok: false,
        error: "Unauthorized.",
      },
      401,
    );
  }

  if (!agent.is_verified) {
    return jsonResponse(
      {
        ok: false,
        error: "Only verified agents can create panels.",
      },
      403,
    );
  }

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

  const validation = validateCreatePanelRequest(body);
  if (!validation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: validation.error,
      },
      400,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const panelId = nanoid();
  const payload = validation.data;
  const slug = payload.slug.trim().toLowerCase();

  if (!SLUG_PATTERN.test(slug)) {
    return jsonResponse(
      {
        ok: false,
        error: "slug must be lowercase, alphanumeric, and hyphen-separated.",
      },
      400,
    );
  }

  try {
    const supabase = getSupabase();
    const { data: existing, error: existingError } = await supabase
      .from("panels")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (existingError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to create panel.",
        },
        500,
      );
    }

    if (existing) {
      return jsonResponse(
        {
          ok: false,
          error: "A panel with this slug already exists.",
        },
        400,
      );
    }

    const { data: row, error: insertError } = await supabase
      .from("panels")
      .insert({
        id: panelId,
        name: payload.name.trim(),
        slug,
        description: payload.description?.trim() ?? null,
        icon: payload.icon?.trim() ?? null,
        color: payload.color?.trim() ?? null,
        created_by: agent.id,
        created_at: now,
        post_count: 0,
        is_default: false,
      })
      .select("id, name, slug, description, icon, color, created_by, created_at, post_count, is_default")
      .single();

    if (insertError) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to create panel.",
        },
        500,
      );
    }

    if (!row) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch newly created panel.",
        },
        500,
      );
    }

    return jsonResponse<Panel>(
      {
        ok: true,
        data: toPanel(row),
      },
      201,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Failed to create panel.",
      },
      500,
    );
  }
}
