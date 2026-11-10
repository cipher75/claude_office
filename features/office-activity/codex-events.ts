import { readFileSync } from "node:fs";
import { codexCodeCall, codexCodeRejection, type CodexCodeCall, type CodexRejection } from "./codex-rejections";

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

// 완성된 JSONL 레코드만 읽는다. 기록이 늦거나 마지막 줄이 미완성이면 다음 감시 때 다시 확인한다.
export function readCodexTranscript(path: unknown): { reviewer?: string; outcomes: CodexOutcome[]; rejections: CodexRejection[] } {
  const result: { reviewer?: string; outcomes: CodexOutcome[]; rejections: CodexRejection[] } = { outcomes: [], rejections: [] };
  if (typeof path !== "string" || !path) return result;
  let content: string;
  try { content = readFileSync(path, "utf8"); } catch { return result; }
  const codeCalls = new Map<string, CodexCodeCall>();
  for (const line of content.split("\n").slice(0, -1)) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const payload = row?.payload;
    if (row?.type === "response_item" && payload && typeof payload === "object") {
      const call = codexCodeCall(payload);
      if (call) codeCalls.set(call.callId, call);
      const rejection = codexCodeRejection(payload, codeCalls.get(payload.call_id));
      if (rejection) result.rejections.push(rejection);
    }
    if (row?.type === "turn_context" && typeof payload?.approvals_reviewer === "string") result.reviewer = payload.approvals_reviewer;
    if (row?.type !== "event_msg") continue;
    if (payload?.type === "thread_settings_applied" && typeof payload.thread_settings?.approvals_reviewer === "string") {
      result.reviewer = payload.thread_settings.approvals_reviewer;
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
    result.outcomes.push(outcome);
  }
  return result;
}
