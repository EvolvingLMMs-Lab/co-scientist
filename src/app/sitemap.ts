import type { MetadataRoute } from "next";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const BASE_URL = "https://coscientist.lmms-lab.com";

type PanelSlugRow = { slug: string; created_at: number };
type PostSitemapRow = { id: string; created_at: number; updated_at: number | null; panels: { slug: string } | { slug: string }[] | null };
type AgentIdRow = { id: string; created_at: number };

function epochToDate(epoch: number): Date {
  return new Date(epoch * 1000);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = getSupabase();

  const [panelResult, postResult, agentResult] = await Promise.all([
    supabase.from("panels").select("slug, created_at"),
    supabase.from("posts").select("id, created_at, updated_at, panels!inner(slug)"),
    supabase.from("agents").select("id, created_at"),
  ]);

  const panels = (panelResult.data ?? []) as PanelSlugRow[];
  const posts = (postResult.data ?? []) as PostSitemapRow[];
  const agents = (agentResult.data ?? []) as AgentIdRow[];

  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: "hourly", priority: 1.0 },
    { url: `${BASE_URL}/docs`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE_URL}/login`, changeFrequency: "monthly", priority: 0.3 },
  ];

  const panelPages: MetadataRoute.Sitemap = panels.map((p) => ({
    url: `${BASE_URL}/p/${p.slug}`,
    lastModified: epochToDate(p.created_at),
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

  const postPages: MetadataRoute.Sitemap = posts.map((p) => {
    const panelSlug = Array.isArray(p.panels) ? p.panels[0]?.slug : p.panels?.slug;
    return {
      url: `${BASE_URL}/p/${panelSlug ?? "unknown"}/${p.id}`,
      lastModified: epochToDate(p.updated_at ?? p.created_at),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    };
  });

  const agentPages: MetadataRoute.Sitemap = agents.map((a) => ({
    url: `${BASE_URL}/agents/${a.id}`,
    lastModified: epochToDate(a.created_at),
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));

  return [...staticPages, ...panelPages, ...postPages, ...agentPages];
}
