import { codexCodeCall, codexCodeRejections, type CodexCodeCall, type CodexRejection } from "./codex-rejections";

type Payload = Record<string, unknown>;
type Wait = { owner: CodexCodeCall; cellId: string; at: number; terminate: boolean };

// transcript 하나를 처음부터 읽는 동안만 보관한다. cell ID는 세션 안에서 턴별로 연결한다.
export function createCodexCodeReader() {
  const calls = new Map<string, CodexCodeCall>();
  const cells = new Map<string, CodexCodeCall | null>();
  const waits = new Map<string, Wait>();
  const chunks = new Map<string, unknown[]>();
  const lastOutputAt = new Map<string, number>();
  const seenOutputs = new Set<string>();
  const rejections: CodexRejection[] = [];

  function read(payload: Payload): void {
    const call = codexCodeCall(payload);
    if (call && !calls.has(call.callId)) calls.set(call.callId, call);
    const metadata = payload.internal_chat_message_metadata_passthrough as Payload | undefined;
    const turnId = metadata?.turn_id;
    const at = typeof metadata?.create_time === "number" ? metadata.create_time * 1000 : NaN;
    if (typeof turnId !== "string" || !Number.isFinite(at) || typeof payload.call_id !== "string") return;
    if (payload.type === "function_call" && payload.name === "wait" && typeof payload.arguments === "string") {
      try {
        const args = JSON.parse(payload.arguments);
        if (typeof args?.cell_id !== "string" || (args.terminate !== undefined && typeof args.terminate !== "boolean")) return;
        const owner = cells.get(cellKey(turnId, args.cell_id));
        if (owner && owner.completedAt === undefined && at >= (lastOutputAt.get(owner.callId) ?? owner.startedAt)) {
          waits.set(payload.call_id, { owner, cellId: args.cell_id, at, terminate: args.terminate === true });
        }
      } catch { /* 불완전하거나 알 수 없는 wait 인수는 연결하지 않는다. */ }
      return;
    }
    const wait = payload.type === "function_call_output" ? waits.get(payload.call_id) : undefined;
    const owner = payload.type === "custom_tool_call_output" ? calls.get(payload.call_id) : wait?.owner;
    if (!owner || owner.turnId !== turnId || owner.completedAt !== undefined ||
      at < (wait?.at ?? owner.startedAt) || at < (lastOutputAt.get(owner.callId) ?? owner.startedAt)) return;
    if (wait && cells.get(cellKey(turnId, wait.cellId)) !== owner) return;
    const outputId = `${payload.type}:${payload.call_id}`;
    if (seenOutputs.has(outputId)) return;
    let output = payload.output;
    if (typeof output === "string") {
      const serialized = output;
      try { output = JSON.parse(serialized); } catch {
        // 출력이 아직 없으면 native Codex는 블록 배열 대신 이 헤더 문자열만 기록한다.
        // 본문이 있는 비구조적 문자열은 블록의 경계를 확정할 수 없으므로 보류한다.
        if (!/^Script [^\n]+\nWall time [^\n]+\nOutput:\n$/.test(serialized)) return;
        output = [{ type: "input_text", text: serialized }];
      }
    }
    if (!Array.isArray(output)) return;
    const header = output[0];
    if (header?.type !== "input_text" || typeof header.text !== "string") return;
    const running = /^Script (?:still )?running with cell ID ([^\n]+)\n/.exec(header.text);
    const terminal = /^Script (?:completed|failed|terminated)\n/.test(header.text);
    if (!running && !terminal) return;
    if (running && wait && running[1] !== wait.cellId) return;
    seenOutputs.add(outputId);
    lastOutputAt.set(owner.callId, at);
    const buffered = [...(chunks.get(owner.callId) ?? []), ...output.slice(1)];
    if (running) {
      const key = cellKey(turnId, running[1]);
      // 같은 턴에서 cell ID를 재사용했거나 wait 결과의 ID가 달라지면 다른 코드에 붙이지 않는다.
      if (cells.has(key) && cells.get(key) !== owner) cells.set(key, null);
      else cells.set(key, owner);
      chunks.set(owner.callId, buffered);
      return;
    }
    owner.completedAt = at;
    chunks.delete(owner.callId);
    if (!wait?.terminate) rejections.push(...codexCodeRejections({
      ...payload, type: "custom_tool_call_output", call_id: owner.callId, output: [header, ...buffered],
    }, owner));
  }

  return { calls, rejections, read };
}

function cellKey(turnId: string, cellId: string): string {
  return JSON.stringify([turnId, cellId]);
}
