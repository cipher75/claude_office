import { closeSync, openSync, readSync, statSync, unwatchFile, watchFile, type Stats } from "node:fs";

// Claude Code는 허용 거절처럼 hook으로 알려 주지 않는 일을 세션 transcript에만 기록한다.
// 이 PC의 transcript 파일에 새로 붙는 줄을 지켜보며 읽는 쪽에 넘기고, 호출의 실행 여부를 읽는 함수도 제공한다.

const POLL_MS = 500;
const NEWLINE = 0x0a;

type Watch = { sessionId: string; offset: number; rest: Buffer; listener: (curr: Stats) => void };
type TranscriptWatchGlobal = typeof globalThis & {
  __officeTranscriptWatches?: Map<string, Watch>;
};

function watches(): Map<string, Watch> {
  const g = globalThis as TranscriptWatchGlobal;
  g.__officeTranscriptWatches ??= new Map();
  return g.__officeTranscriptWatches;
}

// 지켜보기 시작한 시점 이후에 붙는 완성된 줄만 넘긴다. 지난 기록은 화면과 관계없다.
export function followTranscript(sessionId: string, path: string, onLines: (lines: string) => void): void {
  const all = watches();
  if (all.has(path)) return;

  const watch: Watch = { sessionId, offset: sizeOf(path), rest: Buffer.alloc(0), listener: () => {} };
  watch.listener = (curr) => {
    if (curr.size < watch.offset) {
      watch.offset = curr.size;
      watch.rest = Buffer.alloc(0);
      return;
    }
    if (curr.size === watch.offset) return;
    const chunk = Buffer.concat([watch.rest, readRange(path, watch.offset, curr.size)]);
    watch.offset = curr.size;
    const end = chunk.lastIndexOf(NEWLINE);
    watch.rest = chunk.subarray(end + 1);
    if (end >= 0) onLines(chunk.subarray(0, end).toString("utf8"));
  };
  all.set(path, watch);
  watchFile(path, { interval: POLL_MS }, watch.listener);
}

export function stopFollowing(sessionId: string): void {
  const all = watches();
  for (const [path, watch] of all) {
    if (watch.sessionId !== sessionId) continue;
    unwatchFile(path, watch.listener);
    all.delete(path);
  }
}

// 호출이 실제로 실행되었는지. async는 백그라운드로 시작만 알린 호출이고, agentId는 그때 시작한 sub-agent의 id다.
// rejected는 실행되지 않은 호출 중 사용자가 거절했다는 증거가 결과에 있는 경우다.
// toolName과 toolInput은 그 호출의 도구와 입력이다. 서버가 PreToolUse hook을 놓쳐 id 없이 만든
// 허용 대기 캐릭터를 이 호출과 이어 붙이는 데 쓴다.
export type CallInfo = { toolName?: string; toolInput?: unknown };
export type CallOutcome = PendingResult & { executed: boolean };
export type PendingResult = CallInfo & { toolUseId: string; async: boolean; agentId?: string; rejected: boolean };
// pending: 아직 판단하지 못한 결과, calls: 결과를 기다리는 호출의 도구와 입력
export type ReaderState = { pending: PendingResult[]; calls: Record<string, CallInfo> };

export const emptyReaderState = (): ReaderState => ({ pending: [], calls: {} });

// 실행되지 않은 호출에는 거절 말고도 여러 까닭이 있다(허용 요청 만료, 새 메시지로 닫힘, 턴 종료로 건너뜀,
// Esc 취소 등). Claude Code는 이런 결과에 "Nobody refused it"라고 따로 적는다. 그래서 "거절"은
// Claude Code가 거절 결과에 쓰는 아래 두 고정 값 중 하나가 있을 때만 주장하고, 없으면 중단으로 본다.
// 값이 바뀌면 거절이 중단으로 보일 뿐, 하지 않은 거절을 보여주지는 않는다.
const REJECTED_RESULT = "User rejected tool use";
const REJECTED_MESSAGE = "The user doesn't want to proceed with this tool use.";
// 세션이 끊겼다가 이어질 때 Claude Code가 끝나지 않은 호출에 붙이는 결과다. 실행되었는지 모른다고 스스로
// 적으므로 실행 여부를 판단하지 않는다. 실행되지 않았다고 보면 Post hook을 받은 호출과 어긋나 판단이 꺼진다.
const UNKNOWN_OUTCOME = "[Tool call interrupted: the session ended before this call's result was recorded";

// transcript만으로 호출의 실행 여부를 정한다. 결과의 문구는 보지 않고, 줄의 순서만 본다.
// Claude Code는 실행된 호출의 결과 줄 바로 다음에 PostToolUse hook 기록(성공이든 실패든)을 남긴다.
// 실행되지 않은 호출(거절, 중단 등)의 결과 줄 다음에는 이 기록이 없다. 그래서 결과 줄 뒤에
// 같은 tool_use_id의 PostToolUse 기록이 오면 실행된 것이고, 다른 종류의 줄이 오면 실행되지 않은 것이다.
// 병렬 호출의 결과 줄이 이어질 수 있으므로 결과 줄은 판단을 끝내지 않는다.
// 아직 판단하지 못한 결과는 state로 돌려주어 다음에 읽는 줄과 이어서 판단한다.
export function readCallOutcomes(state: ReaderState, lines: string): { state: ReaderState; outcomes: CallOutcome[] } {
  let open = [...state.pending];
  const calls = { ...state.calls };
  const outcomes: CallOutcome[] = [];
  for (const line of lines.split("\n")) {
    const entry = parse(line);
    if (!isRecord(entry)) continue;

    const results = resultsOf(entry);
    if (results.length) {
      for (const { unknown, ...result } of results) {
        if (!unknown) open.push({ ...result, ...calls[result.toolUseId] });
        delete calls[result.toolUseId];
      }
      continue;
    }
    const recorded = postToolUseRecordOf(entry);
    if (recorded !== undefined) {
      const done = open.find((r) => r.toolUseId === recorded);
      if (done) outcomes.push({ ...done, executed: true });
      open = open.filter((r) => r !== done);
      continue;
    }
    outcomes.push(...open.map((r) => ({ ...r, executed: false })));
    open = [];
    Object.assign(calls, toolUsesOf(entry));
  }
  return { state: { pending: open, calls }, outcomes };
}

// 모델이 부른 호출(assistant의 tool_use)의 도구와 입력.
function toolUsesOf(entry: Record<string, unknown>): Record<string, CallInfo> {
  if (entry.type !== "assistant" || !isRecord(entry.message) || !Array.isArray(entry.message.content)) return {};
  const calls: Record<string, CallInfo> = {};
  for (const block of entry.message.content) {
    if (isRecord(block) && block.type === "tool_use" && typeof block.id === "string") {
      calls[block.id] = { toolName: typeof block.name === "string" ? block.name : undefined, toolInput: block.input };
    }
  }
  return calls;
}

function resultsOf(entry: Record<string, unknown>): (PendingResult & { unknown: boolean })[] {
  if (entry.type !== "user" || !isRecord(entry.message) || !Array.isArray(entry.message.content)) return [];
  const summary = entry.toolUseResult;
  const async = isRecord(summary) && summary.isAsync === true;
  const agentId = async && typeof summary.agentId === "string" ? summary.agentId : undefined;
  return entry.message.content.filter(isRecord).flatMap((block) => {
    if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") return [];
    const rejected = summary === REJECTED_RESULT || isRejectionText(summary) || isRejectionText(textOf(block.content));
    const unknown = textOf(block.content).startsWith(UNKNOWN_OUTCOME);
    return [{ toolUseId: block.tool_use_id, async, ...(agentId ? { agentId } : {}), rejected, unknown }];
  });
}

// 일부 도구는 거절 문장 앞에 "Error: "를 붙여 기록한다.
function isRejectionText(value: unknown): boolean {
  return typeof value === "string" && value.replace(/^Error: /, "").startsWith(REJECTED_MESSAGE);
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (isRecord(block) && typeof block.text === "string" ? block.text : "")).join("");
}

// PostToolUse, PostToolUseFailure hook의 기록이면 그 tool_use_id를 돌려준다.
function postToolUseRecordOf(entry: Record<string, unknown>): string | undefined {
  const attachment = entry.attachment;
  if (!isRecord(attachment) || typeof attachment.toolUseID !== "string") return undefined;
  const hook = typeof attachment.hookName === "string" ? attachment.hookName : "";
  return hook.startsWith("PostToolUse") ? attachment.toolUseID : undefined;
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function readRange(path: string, start: number, end: number): Buffer {
  const buffer = Buffer.alloc(end - start);
  const fd = openSync(path, "r");
  try {
    const read = readSync(fd, buffer, 0, buffer.length, start);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
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
