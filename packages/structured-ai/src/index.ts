export type UnknownRecord = Record<string, unknown>;

export interface StructuredPromptSpec {
  role: string;
  objective: string;
  input: unknown;
  outputShape: unknown;
  rules?: string[];
}

export function createStructuredPrompt(
  spec: StructuredPromptSpec
): string {
  const rules = [
    "Return one valid JSON value only. Do not wrap it in Markdown fences.",
    "Do not invent facts, sources, people, contacts, prices or financial figures.",
    "When evidence is missing, state that it is missing instead of guessing.",
    ...(spec.rules ?? [])
  ];

  return [
    `ROLE\n${spec.role.trim()}`,
    `OBJECTIVE\n${spec.objective.trim()}`,
    `INPUT JSON\n${JSON.stringify(spec.input, null, 2)}`,
    `OUTPUT JSON SHAPE\n${JSON.stringify(spec.outputShape, null, 2)}`,
    `RULES\n${rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")}`
  ].join("\n\n");
}

export function asRecord(
  value: unknown
): UnknownRecord {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

export function asArray(
  value: unknown
): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asText(
  value: unknown,
  fallback = ""
): string {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

export function asOptionalText(
  value: unknown
): string | undefined {
  const text = asText(value);
  return text || undefined;
}

export function asStringArray(
  value: unknown
): string[] {
  return asArray(value)
    .map((item) => asText(item))
    .filter(Boolean);
}

export function asNumber(
  value: unknown,
  fallback = 0
): number {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : fallback;
}

export function clampScore(
  value: unknown,
  fallback = 0
): number {
  return Math.max(
    0,
    Math.min(100, Math.round(asNumber(value, fallback)))
  );
}

export function generatedText(
  value: unknown
): string {
  if (typeof value === "string") {
    return value.trim();
  }

  const record = asRecord(value);
  const direct = asText(record.text);
  if (direct) {
    return direct;
  }

  const output = asRecord(record.output);
  const nested = asText(output.text);
  if (nested) {
    return nested;
  }

  const content = asText(record.content);
  if (content) {
    return content;
  }

  return "";
}

export function parseJsonValue<T = unknown>(
  value: unknown
): T | null {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !("text" in value)
  ) {
    return value as T;
  }

  const text = generatedText(value);
  if (!text) {
    return null;
  }

  const candidates = [
    text,
    stripFence(text),
    jsonSlice(text)
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Continue to the next deterministic extraction strategy.
    }
  }

  return null;
}

function stripFence(text: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(
    text.trim()
  );
  return match?.[1]?.trim() ?? text.trim();
}

function jsonSlice(text: string): string {
  const trimmed = text.trim();
  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");

  let start = -1;
  if (objectStart >= 0 && arrayStart >= 0) {
    start = Math.min(objectStart, arrayStart);
  } else {
    start = Math.max(objectStart, arrayStart);
  }

  if (start < 0) {
    return "";
  }

  const open = trimmed[start];
  const close = open === "{" ? "}" : "]";
  const end = trimmed.lastIndexOf(close);

  return end >= start
    ? trimmed.slice(start, end + 1)
    : "";
}
