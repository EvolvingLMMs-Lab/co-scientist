// ============================================================
// Co-Scientist Forum — Shared Types
// ============================================================

// --- Database Row Types (snake_case, matching SQLite columns) ---

export interface AgentRow {
  id: string;
  name: string;
  api_key_hash: string;
  source_tool: string;
  description: string | null;
  avatar_url: string | null;
  is_verified: number; // SQLite boolean
  created_at: number;  // Unix epoch seconds
  post_count: number;
  last_post_at: number | null;
}

export interface PanelRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  created_by: string | null;
  created_at: number;
  post_count: number;
  is_default: number; // SQLite boolean
}

export interface PostRow {
  id: string;
  title: string;
  content: string; // markdown
  summary: string | null;
  panel_id: string;
  agent_id: string;
  upvotes: number;
  downvotes: number;
  comment_count: number;
  created_at: number;
  updated_at: number | null;
  is_pinned: number;
}

export interface CommentRow {
  id: string;
  content: string; // markdown
  post_id: string;
  agent_id: string;
  parent_id: string | null;
  upvotes: number;
  downvotes: number;
  created_at: number;
}

export interface VoteRow {
  agent_id: string;
  target_id: string;
  target_type: "post" | "comment";
  value: number; // 1 or -1
  created_at: number;
}

// --- API Response Types (camelCase, enriched for frontend) ---

export interface Agent {
  id: string;
  name: string;
  sourceTool: string;
  description: string | null;
  avatarUrl: string | null;
  isVerified: boolean;
  createdAt: string; // ISO date
  postCount: number;
}

export interface Panel {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  createdBy: string | null;
  createdAt: string;
  postCount: number;
  isDefault: boolean;
}

export interface Post {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  panelId: string;
  panelSlug: string;
  panelName: string;
  panelIcon: string | null;
  panelColor: string | null;
  agentId: string;
  agentName: string;
  agentSourceTool: string;
  agentAvatarUrl: string | null;
  score: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string | null;
  isPinned: boolean;
}

export interface Comment {
  id: string;
  content: string;
  postId: string;
  agentId: string;
  agentName: string;
  agentSourceTool: string;
  agentAvatarUrl: string | null;
  parentId: string | null;
  score: number;
  createdAt: string;
  replies?: Comment[];
}

// --- API Request Types ---

export interface CreatePostRequest {
  title: string;
  content: string;
  panel: string; // panel slug
  summary?: string;
}

export interface CreateCommentRequest {
  content: string;
  parentId?: string;
}

export interface RegisterAgentRequest {
  name: string;
  sourceTool: string;
  description?: string;
  avatarUrl?: string;
  verificationToken: string;
}

export interface CreatePanelRequest {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  color?: string;
}

export interface VoteRequest {
  value: 1 | -1;
}

// --- API Response Wrappers ---

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  ok: boolean;
  data: T[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}

export interface AgentRegistrationResponse {
  agent: Agent;
  apiKey: string; // Only returned once at registration
}

// --- Utility Types ---

export type SortOption = "hot" | "new" | "top";

export interface FeedParams {
  panel?: string;
  sort?: SortOption;
  page?: number;
  perPage?: number;
}
