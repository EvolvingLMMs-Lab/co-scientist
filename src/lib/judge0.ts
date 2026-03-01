/**
 * Judge0 CE API integration for code bounty auto-verification.
 *
 * Uses the hosted Judge0 CE via RapidAPI. Supports batch submission
 * and polling for results. Language-agnostic stdin/stdout test cases.
 *
 * Env vars:
 *   JUDGE0_API_KEY   - RapidAPI key
 *   JUDGE0_API_URL   - API base URL (default: https://judge0-ce.p.rapidapi.com)
 */

import type { TestCase, TestCaseResult, VerificationResults, VerificationVerdict } from "@/types/bounty";

const JUDGE0_URL = process.env.JUDGE0_API_URL ?? "https://judge0-ce.p.rapidapi.com";
const JUDGE0_KEY = process.env.JUDGE0_API_KEY ?? "";

const LANGUAGE_IDS: Record<string, number> = {
  python: 71,      // Python 3.8.1
  javascript: 63,  // Node.js 12.14.0
  typescript: 74,  // TypeScript 3.7.4
  cpp: 54,         // C++ (GCC 9.2.0)
  java: 62,        // Java (OpenJDK 13.0.1)
  rust: 73,        // Rust 1.40.0
  c: 50,           // C (GCC 9.2.0)
  ruby: 72,        // Ruby 2.7.0
  go: 60,          // Go 1.13.5
};

function getHeaders(): Record<string, string> {
  return {
    "X-RapidAPI-Key": JUDGE0_KEY,
    "X-RapidAPI-Host": new URL(JUDGE0_URL).hostname,
    "Content-Type": "application/json",
  };
}

function verdictFromStatusId(statusId: number): VerificationVerdict {
  switch (statusId) {
    case 3: return "AC";
    case 4: return "WA";
    case 5: return "TLE";
    case 6: return "CE";
    default:
      if (statusId >= 7 && statusId <= 12) return "RE";
      return "RE";
  }
}

export function getSupportedLanguages(): string[] {
  return Object.keys(LANGUAGE_IDS);
}

export function isLanguageSupported(language: string): boolean {
  return language in LANGUAGE_IDS;
}

/**
 * Submit a batch of test cases to Judge0 and poll for results.
 *
 * @param sourceCode - The agent's submitted code
 * @param language - Programming language key (e.g. 'python', 'javascript')
 * @param testCases - Array of stdin/expectedOutput pairs
 * @param timeLimitS - CPU time limit in seconds (default 3)
 * @param memoryLimitKb - Memory limit in KB (default 131072 = 128MB)
 * @returns VerificationResults with per-test-case verdicts
 */
export async function runTestCases(
  sourceCode: string,
  language: string,
  testCases: TestCase[],
  timeLimitS = 3,
  memoryLimitKb = 131072,
): Promise<VerificationResults> {
  const languageId = LANGUAGE_IDS[language];
  if (!languageId) {
    throw new Error(`Unsupported language: ${language}. Supported: ${Object.keys(LANGUAGE_IDS).join(", ")}`);
  }

  if (!JUDGE0_KEY) {
    throw new Error("JUDGE0_API_KEY environment variable is not set");
  }

  if (testCases.length === 0) {
    return { allPassed: true, summary: { passed: 0, total: 0 }, results: [] };
  }

  // Submit batch
  const submissions = testCases.map((tc) => ({
    source_code: sourceCode,
    language_id: languageId,
    stdin: tc.stdin,
    expected_output: tc.expectedOutput,
    cpu_time_limit: timeLimitS,
    memory_limit: memoryLimitKb,
    wall_time_limit: timeLimitS * 3,
  }));

  const batchRes = await fetch(`${JUDGE0_URL}/submissions/batch?base64_encoded=false`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ submissions }),
  });

  if (!batchRes.ok) {
    const text = await batchRes.text();
    throw new Error(`Judge0 batch submission failed (${batchRes.status}): ${text}`);
  }

  const tokens: Array<{ token: string }> = await batchRes.json();
  const tokenStr = tokens.map((t) => t.token).join(",");

  // Poll until all submissions complete (max ~60s with 20 retries at 3s intervals)
  interface Judge0Submission {
    status: { id: number; description: string };
    stdout: string | null;
    stderr: string | null;
    compile_output: string | null;
    time: string | null;
    memory: number | null;
  }

  let completedSubmissions: Judge0Submission[] = [];

  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const pollRes = await fetch(
      `${JUDGE0_URL}/submissions/batch?tokens=${tokenStr}&base64_encoded=false&fields=status,stdout,stderr,compile_output,time,memory`,
      { headers: getHeaders() },
    );

    if (!pollRes.ok) {
      continue;
    }

    const data: { submissions: Judge0Submission[] } = await pollRes.json();
    completedSubmissions = data.submissions;

    // status.id 1=InQueue, 2=Processing. 3+ means done.
    if (completedSubmissions.every((s) => s.status.id >= 3)) {
      break;
    }
  }

  // Map results
  const results: TestCaseResult[] = completedSubmissions.map((s, i) => {
    const tc = testCases[i];
    const verdict = verdictFromStatusId(s.status.id);
    const wallTimeMs = Math.round(parseFloat(s.time ?? "0") * 1000);

    return {
      testCaseId: tc.id,
      passed: verdict === "AC",
      verdict,
      actualOutput: tc.isPublic ? (s.stdout?.trim() ?? undefined) : undefined,
      wallTimeMs,
      memoryKb: s.memory ?? undefined,
    };
  });

  const passed = results.filter((r) => r.passed).length;

  return {
    allPassed: passed === results.length,
    summary: { passed, total: results.length },
    results,
  };
}
