import { closeSync, openSync, readSync, statSync } from "node:fs";
import { createCodexCodeReader } from "./codex-code-results";
import type { CodexCodeCall, CodexRejection } from "./codex-rejections";

const EVENTS = new Set([
  "OfficeConnect", "OfficeDisconnect", "UserPromptSubmit", "PreToolUse",
  "PermissionRequest", "PostToolUse", "Stop", "Interrupt", "SessionEnd",
]);

export function codexOfficeEvent(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const name = payload.hook_event_name;
  if (typeof payload.session_id !== "string" || !payload.session_id ||
    typeof name !== "string" || !EVENTS.has(name) || payload.agent_id) return;
  return { ...payload, source: "codex", session_id: `codex:${payload.session_id}`,
    hook_event_name: name === "Interrupt" ? "Stop" : name,
    ...(name === "Interrupt" ? { stop_reason: "interrupt" } : {}) };
}

export type CodexOutcome = { id: string; status: "declined" | "completed" | "failed"; turnId?: string; completedAt?: number; toolName?: string; toolInput?: unknown };

export type CodexTranscript = { reviewer?: string; outcomes: CodexOutcome[]; rejections: CodexRejection[]; codeCalls: CodexCodeCall[] };

// 같은 기록을 hook과 감시가 계속 다시 읽으므로, 파일마다 해석한 위치와 결과를 기억해 두고 새로 붙은 줄만 해석한다.
// 파일이 줄거나 다른 파일로 바뀌면(inode가 달라지면) 처음부터 다시 읽는다.
type Cursor = {
  ino: number;
  offset: number;
  reviewer?: string;
  outcomes: CodexOutcome[];
  code: ReturnType<typeof createCodexCodeReader>;
};
const CURSORS_MAX = 50;
const cursors = ((globalThis as typeof globalThis & { __officeCodexCursors?: Map<string, Cursor> })
  .__officeCodexCursors ??= new Map<string, Cursor>());

// 완성된 JSONL 레코드만 읽는다. 기록이 늦거나 마지막 줄이 미완성이면 다음 감시 때 다시 확인한다.
export function readCodexTranscript(path: unknown): CodexTranscript {
  if (typeof path !== "string" || !path) return { outcomes: [], rejections: [], codeCalls: [] };
  let stat;
  try { stat = statSync(path); } catch { return { outcomes: [], rejections: [], codeCalls: [] }; }
  let cursor = cursors.get(path);
  if (!cursor || cursor.ino !== stat.ino || stat.size < cursor.offset) {
    cursor = { ino: stat.ino, offset: 0, outcomes: [], code: createCodexCodeReader() };
    cursors.delete(path);
    cursors.set(path, cursor);
    if (cursors.size > CURSORS_MAX) cursors.delete(cursors.keys().next().value as string);
  }
  if (stat.size > cursor.offset) {
    let chunk: Buffer;
    try { chunk = readRange(path, cursor.offset, stat.size); } catch { chunk = Buffer.alloc(0); }
    // 줄바꿈 경계에서 자르므로 여러 바이트 글자가 잘리지 않는다. 미완성 줄은 다음에 처음부터 다시 읽는다.
    const end = chunk.lastIndexOf(0x0a) + 1;
    parse(cursor, chunk.subarray(0, end).toString("utf8"));
    cursor.offset += end;
  }
  return {
    ...(cursor.reviewer !== undefined ? { reviewer: cursor.reviewer } : {}),
    outcomes: [...cursor.outcomes],
    rejections: [...cursor.code.rejections],
    codeCalls: [...cursor.code.calls.values()],
  };
}

function parse(cursor: Cursor, text: string) {
  for (const line of text.split("\n").slice(0, -1)) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const payload = row?.payload;
    if (row?.type === "response_item" && payload && typeof payload === "object") {
      cursor.code.read(payload);
    }
    if (row?.type === "turn_context" && typeof payload?.approvals_reviewer === "string") cursor.reviewer = payload.approvals_reviewer;
    if (row?.type !== "event_msg") continue;
    if (payload?.type === "thread_settings_applied" && typeof payload.thread_settings?.approvals_reviewer === "string") {
      cursor.reviewer = payload.thread_settings.approvals_reviewer;
    }
    const item = payload?.item;
    if (payload?.type !== "item_completed" || !["declined", "completed", "failed"].includes(item?.status) || typeof item.id !== "string") continue;
    const outcome: CodexOutcome = { id: item.id, status: item.status, turnId: payload.turn_id };
    if (typeof payload.completed_at_ms === "number" && Number.isFinite(payload.completed_at_ms)) outcome.completedAt = payload.completed_at_ms;
    // 실제 CommandExecution은 셸과 인수 배열을 기록한다.
    const command = item.command;
    if (item.type === "CommandExecution" && Array.isArray(command) && command.length === 3 && ["-lc", "-c"].includes(command[1])) {
      outcome.toolName = "Bash";
      outcome.toolInput = { command: command[2] };
    }
    cursor.outcomes.push(outcome);
  }
}

function readRange(path: string, start: number, end: number): Buffer {
  const buffer = Buffer.alloc(end - start);
  const fd = openSync(path, "r");
  try {
    return buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, start));
  } finally {
    closeSync(fd);
  }
}
