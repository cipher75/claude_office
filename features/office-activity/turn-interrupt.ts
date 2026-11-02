// 사용자가 Esc로 작업을 중단하면 Claude Code는 Stop hook을 보내지 않는다.
// 대신 본 세션 transcript에 "[Request interrupted by user]"로 시작하는 사용자 메시지가 붙으므로, 그 줄로 턴이 끝난 것을 안다.

const INTERRUPTED = "[Request interrupted by user";

export function hasInterruptedTurn(lines: string): boolean {
  for (const line of lines.split("\n")) {
    if (!line.includes(INTERRUPTED)) continue;
    if (isInterruptMessage(line)) return true;
  }
  return false;
}

function isInterruptMessage(line: string): boolean {
  try {
    const entry: unknown = JSON.parse(line);
    if (!isRecord(entry) || entry.type !== "user" || entry.isSidechain === true) return false;
    const message = entry.message;
    if (!isRecord(message)) return false;
    const content = message.content;
    if (typeof content === "string") return content.startsWith(INTERRUPTED);
    return Array.isArray(content) && content.some((block) => isRecord(block) && block.type === "text" && typeof block.text === "string" && block.text.startsWith(INTERRUPTED));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
