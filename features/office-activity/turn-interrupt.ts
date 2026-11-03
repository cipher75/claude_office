// 사용자가 Esc로 작업을 중단하면 Claude Code는 Stop hook을 보내지 않는다.
// 일반 중단은 시각으로, 도구 중단은 같은 줄 또는 바로 앞 결과의 호출 id까지 함께 읽어 지난 턴의 중단을 구분한다.

const INTERRUPTED = "[Request interrupted by user";
const TOOL_INTERRUPTED = "[Request interrupted by user for tool use";

export type TurnInterruption = { kind: "turn" | "tool"; at?: number; toolUseId?: string };
export type InterruptionReaderState = { previousToolUseId?: string };

export function readTurnInterruptions(state: InterruptionReaderState, lines: string): {
  state: InterruptionReaderState;
  interruptions: TurnInterruption[];
} {
  let previousToolUseId = state.previousToolUseId;
  const interruptions: TurnInterruption[] = [];
  for (const line of lines.split("\n")) {
    if (!line.trim()) continue;
    const entry = parse(line);
    if (!isRecord(entry) || entry.type !== "user" || entry.isSidechain === true || !isRecord(entry.message)) {
      previousToolUseId = undefined;
      continue;
    }
    const content = entry.message.content;
    const result = Array.isArray(content)
      ? content.findLast((block) => isRecord(block) && block.type === "tool_result" && typeof block.tool_use_id === "string")
      : undefined;
    const currentToolUseId = isRecord(result) && typeof result.tool_use_id === "string" ? result.tool_use_id : undefined;
    const texts = typeof content === "string" ? [content] : Array.isArray(content)
      ? content.filter(isRecord).flatMap((block) => block.type === "text" && typeof block.text === "string" ? [block.text] : [])
      : [];
    const interrupted = texts.find((text) => text.startsWith(INTERRUPTED));
    if (interrupted) {
      const at = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
      const tool = interrupted.startsWith(TOOL_INTERRUPTED);
      interruptions.push({
        kind: tool ? "tool" : "turn",
        at: Number.isFinite(at) ? at : undefined,
        ...(tool ? { toolUseId: currentToolUseId ?? previousToolUseId } : {}),
      });
    }
    previousToolUseId = currentToolUseId;
  }
  return { state: { previousToolUseId }, interruptions };
}

function parse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
