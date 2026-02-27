import { createHash, randomBytes, randomInt } from "node:crypto";

export type ChallengeType =
  | "crypto"
  | "code"
  | "math"
  | "json"
  | "pattern"
  | "matrix"
  | "regex";

export interface GeneratedChallengePayload {
  prompt: string;
  data: unknown;
  expectedAnswer: string;
}

const LOWERCASE_ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGIT_ALPHABET = "0123456789";
const HEX_ALPHABET = "0123456789abcdef";
const ALPHANUM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomFromAlphabet(length: number, alphabet: string): string {
  const bytes = randomBytes(length);
  let output = "";
  for (let i = 0; i < length; i += 1) {
    output += alphabet[bytes[i] % alphabet.length];
  }
  return output;
}

function randomIntInclusive(min: number, max: number): number {
  return randomInt(min, max + 1);
}

function randomNonZeroInt(min: number, max: number): number {
  let value = 0;
  while (value === 0) {
    value = randomIntInclusive(min, max);
  }
  return value;
}

function countOverlappingOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0 || needle.length > haystack.length) {
    return 0;
  }

  let count = 0;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    if (haystack.slice(i, i + needle.length) === needle) {
      count += 1;
    }
  }
  return count;
}

function shuffle<T>(items: T[]): T[] {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const swapIndex = randomInt(0, i + 1);
    [output[i], output[swapIndex]] = [output[swapIndex], output[i]];
  }
  return output;
}

function evaluateCodeSnippet(values: number[], x: number, bias: number, modBase: number): number {
  let acc = bias;
  for (let i = 0; i < values.length; i += 1) {
    const current = values[i];
    const weight = (x % 5) + 1;

    if ((i + x) % 2 === 0) {
      acc += current * (i + 1);
    } else {
      acc -= current * weight;
    }

    if (acc % 3 === 0) {
      acc += i - (x % 4);
    } else {
      acc -= i % 2;
    }
  }

  return ((acc % modBase) + modBase) % modBase;
}

function formatPolynomial(
  a4: number,
  a3: number,
  a2: number,
  a1: number,
  a0: number,
): string {
  const terms = [
    { coefficient: a4, power: 4 },
    { coefficient: a3, power: 3 },
    { coefficient: a2, power: 2 },
    { coefficient: a1, power: 1 },
    { coefficient: a0, power: 0 },
  ];

  let expression = "";
  for (const term of terms) {
    if (term.coefficient === 0) {
      continue;
    }

    const absCoefficient = Math.abs(term.coefficient);
    const sign = term.coefficient < 0 ? "-" : "+";
    const base =
      term.power === 0
        ? `${absCoefficient}`
        : term.power === 1
          ? `${absCoefficient === 1 ? "" : absCoefficient}x`
          : `${absCoefficient === 1 ? "" : absCoefficient}x^${term.power}`;

    if (expression.length === 0) {
      expression = term.coefficient < 0 ? `-${base}` : base;
    } else {
      expression += ` ${sign} ${base}`;
    }
  }

  return expression.length > 0 ? expression : "0";
}

function integratePolynomialAt(
  a4: number,
  a3: number,
  a2: number,
  a1: number,
  a0: number,
  x: number,
): number {
  return (
    (a4 * x ** 5) / 5 +
    (a3 * x ** 4) / 4 +
    (a2 * x ** 3) / 3 +
    (a1 * x ** 2) / 2 +
    a0 * x
  );
}

function determinant3x3(matrix: number[][]): number {
  const [a, b, c] = matrix[0];
  const [d, e, f] = matrix[1];
  const [g, h, i] = matrix[2];

  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

export function generateCryptoChallenge(): GeneratedChallengePayload {
  const input = randomBytes(32).toString("hex");
  const expectedAnswer = createHash("sha256").update(input).digest("hex");

  return {
    prompt:
      "Compute SHA-256 for the provided input string. Return only the lowercase hex digest.\n" +
      `Input: ${input}`,
    data: {
      algorithm: "sha256",
      outputEncoding: "hex",
      input,
    },
    expectedAnswer,
  };
}

export function generateCodeChallenge(): GeneratedChallengePayload {
  const values = Array.from({ length: 10 }, () => randomNonZeroInt(-9, 9));
  const x = randomIntInclusive(6, 27);
  const bias = randomIntInclusive(-25, 25);
  const modBases = [97, 101, 103, 107, 109];
  const modBase = modBases[randomInt(0, modBases.length)];

  const expectedAnswer = String(evaluateCodeSnippet(values, x, bias, modBase));

  const code = [
    "function compute(x) {",
    `  const values = [${values.join(", ")}];`,
    `  let acc = ${bias};`,
    `  const modBase = ${modBase};`,
    "  for (let i = 0; i < values.length; i += 1) {",
    "    const current = values[i];",
    "    const weight = (x % 5) + 1;",
    "    if ((i + x) % 2 === 0) {",
    "      acc += current * (i + 1);",
    "    } else {",
    "      acc -= current * weight;",
    "    }",
    "    if (acc % 3 === 0) {",
    "      acc += i - (x % 4);",
    "    } else {",
    "      acc -= i % 2;",
    "    }",
    "  }",
    "  return ((acc % modBase) + modBase) % modBase;",
    "}",
  ].join("\n");

  return {
    prompt:
      "Analyze the JavaScript function and return its output for the specified input. Return only the integer.\n" +
      `Input: x = ${x}\nCode:\n${code}`,
    data: {
      language: "javascript",
      code,
      input: { x },
      outputFormat: "integer",
    },
    expectedAnswer,
  };
}

export function generateMathChallenge(): GeneratedChallengePayload {
  const a4 = randomNonZeroInt(-4, 4) * 5;
  const a3 = randomIntInclusive(-6, 6) * 4;
  const a2 = randomIntInclusive(-8, 8) * 3;
  const a1 = randomIntInclusive(-10, 10) * 2;
  const a0 = randomIntInclusive(-12, 12);

  const lowerBound = randomIntInclusive(-5, 1);
  const upperBound = lowerBound + randomIntInclusive(2, 7);

  const expression = formatPolynomial(a4, a3, a2, a1, a0);
  const integrated =
    integratePolynomialAt(a4, a3, a2, a1, a0, upperBound) -
    integratePolynomialAt(a4, a3, a2, a1, a0, lowerBound);
  const expectedAnswer = String(Math.round(integrated));

  return {
    prompt:
      "Compute the exact definite integral and return only the integer result.\n" +
      `Integral: integrate (${expression}) dx from x=${lowerBound} to x=${upperBound}`,
    data: {
      expression,
      operation: "definite_integral",
      lowerBound,
      upperBound,
      variable: "x",
      outputFormat: "integer",
    },
    expectedAnswer,
  };
}

export function generateJsonChallenge(): GeneratedChallengePayload {
  const regions = Array.from({ length: 4 }, (_, regionIndex) => ({
    id: `region-${regionIndex}-${randomFromAlphabet(4, ALPHANUM_ALPHABET)}`,
    nodes: Array.from({ length: 4 }, (_, nodeIndex) => ({
      id: `node-${regionIndex}-${nodeIndex}`,
      meta: {
        tags: Array.from({ length: 4 }, (_, tagIndex) => ({
          id: `tag-${regionIndex}-${nodeIndex}-${tagIndex}-${randomFromAlphabet(3, ALPHANUM_ALPHABET)}`,
          score: randomIntInclusive(1, 99),
        })),
        active: randomIntInclusive(0, 1) === 1,
      },
      metrics: {
        latencyMs: randomIntInclusive(12, 380),
      },
    })),
  }));

  const regionIndex = randomIntInclusive(0, regions.length - 1);
  const nodeIndex = randomIntInclusive(0, regions[regionIndex].nodes.length - 1);
  const tagIndex = randomIntInclusive(0, regions[regionIndex].nodes[nodeIndex].meta.tags.length - 1);

  const targetValue = `value-${randomFromAlphabet(8, ALPHANUM_ALPHABET)}`;
  regions[regionIndex].nodes[nodeIndex].meta.tags[tagIndex].id = targetValue;

  const json = {
    data: {
      regions,
      envelope: {
        generatedAtEpochMs: Date.now(),
      },
    },
  };

  const path = `data.regions[${regionIndex}].nodes[${nodeIndex}].meta.tags[${tagIndex}].id`;

  return {
    prompt:
      "Read the JSON and return the value at the target path. Return the raw scalar string without quotes.\n" +
      `Path: ${path}`,
    data: {
      json,
      path,
      outputFormat: "raw_scalar_string",
    },
    expectedAnswer: targetValue,
  };
}

export function generatePatternChallenge(): GeneratedChallengePayload {
  const text = randomFromAlphabet(500, LOWERCASE_ALPHABET);
  const needleStart = randomInt(0, text.length - 2);
  const needle = text.slice(needleStart, needleStart + 3);
  const count = countOverlappingOccurrences(text, needle);

  return {
    prompt:
      "Count how many times the trigram appears in the text, including overlapping matches. Return only the integer count.\n" +
      `Trigram: ${needle}`,
    data: {
      text,
      trigram: needle,
      countMode: "overlap",
      outputFormat: "integer",
    },
    expectedAnswer: String(count),
  };
}

export function generateMatrixChallenge(): GeneratedChallengePayload {
  const matrix = Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => randomIntInclusive(-9, 9)),
  );
  const determinant = determinant3x3(matrix);

  return {
    prompt:
      "Compute the determinant of the matrix. Return only the integer result.\n" +
      `Matrix: ${JSON.stringify(matrix)}`,
    data: {
      matrix,
      operation: "determinant",
      size: "3x3",
      outputFormat: "integer",
    },
    expectedAnswer: String(determinant),
  };
}

export function generateRegexChallenge(): GeneratedChallengePayload {
  const pattern = "^(?:[A-Z]{2}\\d{2}|x[a-f0-9]{4}z)$";

  const matching = [
    `${randomFromAlphabet(2, UPPERCASE_ALPHABET)}${randomFromAlphabet(2, DIGIT_ALPHABET)}`,
    `${randomFromAlphabet(2, UPPERCASE_ALPHABET)}${randomFromAlphabet(2, DIGIT_ALPHABET)}`,
    `x${randomFromAlphabet(4, HEX_ALPHABET)}z`,
    `x${randomFromAlphabet(4, HEX_ALPHABET)}z`,
  ];

  const nonMatching = [
    `${randomFromAlphabet(2, UPPERCASE_ALPHABET)}${randomFromAlphabet(3, DIGIT_ALPHABET)}`,
    `${randomFromAlphabet(2, LOWERCASE_ALPHABET)}${randomFromAlphabet(2, DIGIT_ALPHABET)}`,
    `x${randomFromAlphabet(4, UPPERCASE_ALPHABET)}z`,
    `x${randomFromAlphabet(3, HEX_ALPHABET)}z`,
    `${randomFromAlphabet(2, UPPERCASE_ALPHABET)}${randomFromAlphabet(1, DIGIT_ALPHABET)}${randomFromAlphabet(1, LOWERCASE_ALPHABET)}`,
    `${randomFromAlphabet(3, UPPERCASE_ALPHABET)}${randomFromAlphabet(2, DIGIT_ALPHABET)}`,
  ];

  const inputs = shuffle([...matching, ...nonMatching]);
  const regex = new RegExp(pattern);
  const matchingIndexes: number[] = [];

  for (let i = 0; i < inputs.length; i += 1) {
    if (regex.test(inputs[i])) {
      matchingIndexes.push(i);
    }
  }

  const expectedAnswer =
    matchingIndexes.length > 0 ? matchingIndexes.join(",") : "none";

  return {
    prompt:
      "Evaluate the regex against each candidate string. Return matching 0-based indices as a comma-separated list in ascending order, or 'none'.",
    data: {
      pattern,
      indexBase: 0,
      candidates: inputs,
      outputFormat: "comma_separated_indices_or_none",
    },
    expectedAnswer,
  };
}

export const CHALLENGE_TYPES: ChallengeType[] = [
  "crypto",
  "code",
  "math",
  "json",
  "pattern",
  "matrix",
  "regex",
];

export const CHALLENGE_GENERATORS: Record<ChallengeType, () => GeneratedChallengePayload> = {
  crypto: generateCryptoChallenge,
  code: generateCodeChallenge,
  math: generateMathChallenge,
  json: generateJsonChallenge,
  pattern: generatePatternChallenge,
  matrix: generateMatrixChallenge,
  regex: generateRegexChallenge,
};
