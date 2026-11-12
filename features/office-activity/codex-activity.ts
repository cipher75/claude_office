type Payload = Record<string, unknown>;
export type CodexActivity = { at: number; event: Payload; turnIds?: string[] };

// hook이 없는 데스크톱 실행 경로도 실제 기록에 있는 턴·바깥 도구 호출만 표시한다.
// 프롬프트, reasoning 본문, 도구 입력·출력은 화면 상태에 옮기지 않는다.
export function createCodexActivityReader() {
  let turn: { id: string; start: CodexActivity; end?: CodexActivity } | undefined;
  const calls = new Map<string, CodexActivity>();
  const cells = new Map<string, string>();
  const waits = new Map<string, string>();
  const turnIds = new Set<string>();

  function read(lines: string): CodexActivity[] {
    const events: CodexActivity[] = [];
    for (const line of lines.split("\n")) {
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const p = row?.payload;
      const at = Date.parse(row?.timestamp);
      if (!p || !Number.isFinite(at)) continue;
      if (row.type === "event_msg") {
        const rootId = typeof p.root_turn_id === "string" && p.root_turn_id ? p.root_turn_id : p.turn_id;
        if (p.type === "task_started" && typeof p.turn_id === "string") {
          if (turn && turn.id === rootId) {
            turnIds.add(p.turn_id);
            // 중단된 턴을 같은 루트로 다시 이어 가는 경우(daemon_recovery 등)는 턴을 다시 연다.
            if (!turn.end) continue;
            const start = { at, turnIds: [...turnIds], event: { hook_event_name: "UserPromptSubmit", turn_id: rootId } };
            turn = { id: rootId, start };
            events.push(start);
            continue;
          }
          if (turn && !turn.end && calls.size > 0) {
            events.push({ at, turnIds: [...turnIds], event: { hook_event_name: "CodexTranscriptSuperseded", turn_id: turn.id } });
          }
          calls.clear(); cells.clear(); waits.clear();
          turnIds.clear(); turnIds.add(rootId); turnIds.add(p.turn_id);
          const start = { at, turnIds: [...turnIds], event: { hook_event_name: "UserPromptSubmit", turn_id: rootId } };
          turn = { id: rootId, start };
          events.push(start);
        } else if (["task_complete", "turn_aborted"].includes(p.type) && turn && rootId === turn.id && !turn.end) {
          turn.end = { at, turnIds: [...turnIds], event: { hook_event_name: "Stop", turn_id: turn.id,
            ...(p.type === "turn_aborted" ? { stop_reason: "interrupt" } : {}) } };
          events.push(turn.end);
          calls.clear(); cells.clear(); waits.clear();
        }
        continue;
      }
      if (row.type !== "response_item" || !turn || turn.end || typeof p.call_id !== "string") continue;
      const metadata = p.internal_chat_message_metadata_passthrough;
      const recordedTurn = metadata?.root_turn_id ?? metadata?.turn_id;
      if (recordedTurn && !turnIds.has(recordedTurn)) continue;
      if (["function_call", "custom_tool_call"].includes(p.type) && typeof p.name === "string") {
        if (calls.has(p.call_id) || waits.has(p.call_id)) continue;
        if (p.name === "wait") {
          try {
            const owner = cells.get(JSON.parse(p.arguments).cell_id);
            if (owner) { waits.set(p.call_id, owner); continue; }
          } catch { /* 연결할 ID를 모르는 wait는 독립 호출로 표시한다. */ }
        }
        const call = { at, turnIds: [...turnIds], event: { hook_event_name: "PreToolUse", turn_id: turn.id,
          tool_use_id: `codex-transcript:${p.call_id}`, tool_name: p.name === "exec" ? "코드 실행" : p.name,
          tool_input: null, activity_origin: "transcript" } };
        calls.set(p.call_id, call);
        events.push(call);
      } else if (["function_call_output", "custom_tool_call_output"].includes(p.type)) {
        const id = waits.get(p.call_id) ?? p.call_id;
        const call = calls.get(id);
        if (!call) continue;
        const header = outputHeader(p.output);
        const running = /^Script (?:still )?running with cell ID ([^\n]+)/.exec(header);
        if (running) { cells.set(running[1], id); continue; }
        events.push({ at, turnIds: [...turnIds], event: { ...call.event, hook_event_name: "PostToolUse" } });
        calls.delete(id);
        for (const [cell, owner] of cells) if (owner === id) cells.delete(cell);
        waits.delete(p.call_id);
      }
    }
    return events;
  }

  // 연결 전의 완료 호출은 재생하지 않는다. 마지막 턴과 아직 열린 호출만 복구한다.
  function snapshot(): CodexActivity[] {
    return turn ? [turn.start, ...(turn.end ? [turn.end] : calls.values())].map((activity) => ({ ...activity, turnIds: [...turnIds] })) : [];
  }
  return { read, snapshot };
}

function outputHeader(value: unknown): string {
  if (typeof value === "string") {
    try { return outputHeader(JSON.parse(value)); } catch { return value; }
  }
  if (Array.isArray(value)) return typeof value[0]?.text === "string" ? value[0].text : "";
  return "";
}
