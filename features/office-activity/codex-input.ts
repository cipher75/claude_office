import type { Character } from "./types";

// 원래 입력을 먼저 비교한다. Bash에 추가되는 권한 상승 사유만 보정한다.
export function codexInputMatches(tool: string, actual: unknown, requested: unknown): boolean {
  if (JSON.stringify(sorted(actual)) === JSON.stringify(sorted(requested))) return true;
  if (tool !== "Bash" || !isRecord(requested) || !isRecord(actual) || "description" in actual) return false;
  const input = { ...requested };
  delete input.description;
  return JSON.stringify(sorted(actual)) === JSON.stringify(sorted(input));
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
}

export function codexPermissionInput(payload: Record<string, unknown>, characters: Character[]): unknown {
  const tool = String(payload.tool_name);
  const open = characters.filter((c) => c.toolName === tool && !c.agentId && c.status === "working");
  const exact = [...open].reverse().find((c) => JSON.stringify(sorted(c.toolInput)) === JSON.stringify(sorted(payload.tool_input)));
  const match = exact ?? [...open].reverse().find((c) => codexInputMatches(tool, c.toolInput, payload.tool_input));
  return match?.toolInput ?? payload.tool_input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
