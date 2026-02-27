const KNOWN_AGENT_SIGNATURES = [
  "anthropic",
  "claude",
  "openai",
  "gpt",
  "langchain",
  "llamaindex",
  "autogen",
  "crewai",
  "cursor",
  "copilot",
  "agent",
];

const KNOWN_BROWSER_SIGNATURES = [
  "mozilla/",
  "chrome/",
  "safari/",
  "firefox/",
  "edg/",
];

const HUMAN_CONVERSATIONAL_MARKERS =
  /\b(i think|in my opinion|imo|personally|lol|lmao|bro|dude)\b/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeHeader(value: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function findSignature(value: string, signatures: string[]): string | null {
  for (const signature of signatures) {
    if (value.includes(signature)) {
      return signature;
    }
  }

  return null;
}

function scoreContentSignals(content: string): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const hasMarkdownHeading = /^#{1,6}\s.+$/m.test(content);
  if (hasMarkdownHeading) {
    score += 0.08;
    reasons.push("content includes markdown headings");
  }

  const hasMarkdownList = /^\s*(?:[-*+]\s+|\d+\.\s+)/m.test(content);
  if (hasMarkdownList) {
    score += 0.08;
    reasons.push("content includes structured list formatting");
  }

  const hasCodeOrMathFence = /```[\s\S]*?```|\$\$[\s\S]*?\$\$/m.test(content);
  if (hasCodeOrMathFence) {
    score += 0.1;
    reasons.push("content includes fenced code or math blocks");
  }

  const headingCount = (content.match(/^#{1,6}\s.+$/gm) ?? []).length;
  if (headingCount >= 2) {
    score += 0.08;
    reasons.push("content shows multi-section structure");
  }

  const hasCitationStyle = /\[[^\]]+\]\(https?:\/\/[^\s)]+\)/i.test(content);
  if (hasCitationStyle) {
    score += 0.05;
    reasons.push("content includes citation-style links");
  }

  if (content.length >= 600) {
    score += 0.06;
    reasons.push("content length is typical of generated research drafts");
  }

  if (content.length <= 80) {
    score -= 0.12;
    reasons.push("very short content lowers confidence of automated generation");
  }

  if (HUMAN_CONVERSATIONAL_MARKERS.test(content)) {
    score -= 0.15;
    reasons.push("human conversational markers detected");
  }

  return { score, reasons };
}

export function assessAgentLikelihood(
  request: Request,
  content: string,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const userAgent = normalizeHeader(request.headers.get("user-agent"));
  const declaredAgentTool = normalizeHeader(request.headers.get("x-agent-tool"));

  if (declaredAgentTool) {
    score += 0.4;
    reasons.push("X-Agent-Tool header is present");

    const matchedToolSignature = findSignature(
      declaredAgentTool,
      KNOWN_AGENT_SIGNATURES,
    );
    if (matchedToolSignature) {
      score += 0.15;
      reasons.push(`X-Agent-Tool matches known signature '${matchedToolSignature}'`);
    }
  }

  if (!userAgent) {
    score += 0.08;
    reasons.push("User-Agent header is missing");
  } else {
    const agentUserAgentSignature = findSignature(
      userAgent,
      KNOWN_AGENT_SIGNATURES,
    );
    if (agentUserAgentSignature) {
      score += 0.32;
      reasons.push(
        `User-Agent matches known agent signature '${agentUserAgentSignature}'`,
      );
    }

    const browserSignature = findSignature(userAgent, KNOWN_BROWSER_SIGNATURES);
    if (browserSignature && !declaredAgentTool) {
      score -= 0.1;
      reasons.push(
        `User-Agent resembles browser traffic ('${browserSignature}') without X-Agent-Tool`,
      );
    }
  }

  const contentSignal = scoreContentSignals(content);
  score += contentSignal.score;
  reasons.push(...contentSignal.reasons);

  return {
    score: clamp(score, 0, 1),
    reasons,
  };
}

export function isLikelyAgent(request: Request, content: string): boolean {
  return assessAgentLikelihood(request, content).score > 0.3;
}
