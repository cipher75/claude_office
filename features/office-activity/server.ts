import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { basename, dirname } from "node:path";

import { codexOfficeEvent, readCodexTranscript } from "./codex-events";
import { codexPermissionInput } from "./codex-input";
import { relayConfigFromEnv } from "./hosted/deployment";
import { createRelay } from "./hosted/relay";
import { recordRawEvent } from "./raw-event-log";
import { applyHookEvent, emptyOfficeState, pruneOfficeState } from "./session-state";
import { finishedTaskToolUseIds } from "./task-notification";
import { latestModelRequestAt } from "./model-request";
import { readTurnInterruptions, type InterruptionReaderState, type TurnInterruption } from "./turn-interrupt";
import { emptyReaderState, followTranscript, readCallOutcomes, stopFollowing } from "./transcript-watch";
import type { OfficeState } from "./types";

// 서버 전용 진입점: hook 이벤트를 받아 사무실 상태를 만들고, 화면에 알린다.
// API 라우트와 instrumentation은 이 파일로만 기능을 가져간다.
export { isHostedDeployment } from "./hosted/deployment";
export { hostedHandlersFromEnv } from "./hosted/server";
export { listRawEvents } from "./raw-event-log";

type Listener = (state: OfficeState) => void;
type OfficeStoreGlobal = typeof globalThis & {
  __officeStore?: { state: OfficeState; listeners: Set<Listener> };
};

function store() {
  const g = globalThis as OfficeStoreGlobal;
  // instance는 서버가 켜질 때마다 새로 정한다. 화면은 이 값이 바뀌면 서버가 다시 켜진 것을 안다.
  g.__officeStore ??= { state: { ...emptyOfficeState(), instance: crypto.randomUUID() }, listeners: new Set() };
  return g.__officeStore;
}

export function ingestHookEvent(payload: Record<string, unknown>, now = Date.now()): void {
  recordRawEvent(payload, now);
  if (payload.source === "codex") {
    const event = codexOfficeEvent(payload);
    if (!event) return;
    const s = store();
    const id = event.session_id as string;
    // Codex hook은 프로젝트 전체에 등록된다. 명시적으로 연결한 세션만 표시한다.
    if (event.hook_event_name !== "OfficeConnect" && !s.state.sessions[id] && !s.state.retired?.[id]) return;
    const session = s.state.sessions[id] ?? s.state.retired?.[id];
    if (session?.closed && event.hook_event_name !== "OfficeConnect") return;
    if (event.hook_event_name === "PermissionRequest") {
      event.tool_input = codexPermissionInput(event, session?.characters ?? []);
    }
    const transcript = readCodexTranscript(event.transcript_path);
    applyCodexOutcomes(id, transcript, now);
    const autoReviewed = event.hook_event_name === "PermissionRequest" && transcript.reviewer === "auto_review";
    if (!autoReviewed) s.state = applyHookEvent(s.state, withProjectRoot(event), now);
    followCodexTranscript(id, event);
    notify();
    return;
  }
  const s = store();
  s.state = applyHookEvent(s.state, withProjectRoot(payload), now);
  notify();
  rememberHooked(payload);
  followTranscripts(payload);
}

function applyCodexOutcomes(id: string, transcript: ReturnType<typeof readCodexTranscript>, now: number) {
  const s = store();
  for (const call of transcript.outcomes) {
    const session = s.state.sessions[id] ?? s.state.retired?.[id];
    if (!session || session.closed || !session.characters.some((c) =>
      c.id === call.id || (c.orphan && call.turnId && c.turnId === call.turnId))) continue;
    s.state = applyHookEvent(s.state, {
      hook_event_name: call.status === "declined" ? "CodexDeclined" : "CodexExecuted", session_id: id, tool_use_id: call.id,
      turn_id: call.turnId, tool_name: call.toolName, tool_input: call.toolInput,
      completed_at: call.completedAt,
    }, now);
  }
  for (const rejection of transcript.rejections) {
    s.state = applyHookEvent(s.state, {
      hook_event_name: "CodexRejectedCall", session_id: id, wrapper_call_id: rejection.callId,
      turn_id: rejection.turnId, tool_input: { command: rejection.command },
      started_at: rejection.startedAt, completed_at: rejection.completedAt,
    }, now);
  }

}

type CodexWatchGlobal = typeof globalThis & { __officeCodexWatchEnds?: Map<string, ReturnType<typeof setTimeout>> };
const codexWatchEnds = ((globalThis as CodexWatchGlobal).__officeCodexWatchEnds ??= new Map());

function followCodexTranscript(id: string, event: Record<string, unknown>) {
  clearTimeout(codexWatchEnds.get(id));
  codexWatchEnds.delete(id);
  if (event.hook_event_name === "OfficeDisconnect") {
    stopFollowing(id);
    return;
  }
  const path = event.transcript_path;
  if (typeof path === "string" && path) {
    followTranscript(id, path, () => {
      applyCodexOutcomes(id, readCodexTranscript(path), Date.now());
      notify();
    });
    // 등록 직전 저장된 줄도 놓치지 않는다.
    applyCodexOutcomes(id, readCodexTranscript(path), Date.now());
  }
  if (event.hook_event_name === "SessionEnd") {
    // 퇴근 장면이 남아 있는 동안 늦게 저장된 거절도 보정한다.
    const timer = setTimeout(() => {
      stopFollowing(id);
      codexWatchEnds.delete(id);
    }, 8_000);
    timer.unref?.();
    codexWatchEnds.set(id, timer);
  }
}

// 워크트리에서 연 세션도 원래 저장소로 묶도록, cwd가 속한 저장소의 경로를 찾아 이벤트에 붙인다.
// 폴더마다 한 번만 git에 묻고 기억한다. git 저장소가 아니면 붙이지 않아 폴더 이름으로 묶인다.
const projectRoots = new Map<string, string | null>();

function withProjectRoot(payload: Record<string, unknown>): Record<string, unknown> {
  const cwd = payload.cwd;
  if (typeof cwd !== "string" || !cwd) return payload;
  if (!projectRoots.has(cwd)) projectRoots.set(cwd, gitProjectRoot(cwd));
  const root = projectRoots.get(cwd);
  return root ? { ...payload, project_root: root } : payload;
}

function gitProjectRoot(cwd: string): string | null {
  try {
    const common = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return basename(common) === ".git" ? dirname(common) : common;
  } catch {
    return null;
  }
}

// transcript 형식이 바뀌었는지 스스로 확인하기 위해, Post hook을 받은 호출을 기억해 둔다.
// transcript가 이 호출을 "실행되지 않음"이라고 읽으면 판단기가 형식을 잘못 읽고 있다는 뜻이다.
const HOOKED_MAX = 2_000;
type HookedGlobal = typeof globalThis & { __officeHooked?: Map<string, Set<string>> };

function hookedIds(sessionId: string): Set<string> {
  const g = globalThis as HookedGlobal;
  g.__officeHooked ??= new Map();
  let ids = g.__officeHooked.get(sessionId);
  if (!ids) g.__officeHooked.set(sessionId, (ids = new Set()));
  return ids;
}

function rememberHooked(payload: Record<string, unknown>) {
  const { session_id: sessionId, tool_use_id: toolUseId, hook_event_name: name } = payload;
  if (typeof sessionId !== "string" || !sessionId) return;
  if (name === "SessionEnd") {
    (globalThis as HookedGlobal).__officeHooked?.delete(sessionId);
    return;
  }
  if ((name !== "PostToolUse" && name !== "PostToolUseFailure") || typeof toolUseId !== "string") return;
  const ids = hookedIds(sessionId);
  ids.add(toolUseId);
  if (ids.size > HOOKED_MAX) ids.delete(ids.values().next().value as string);
}

// 허용 거절과 백그라운드 작업 완료는 transcript에만 남으므로, hook이 알려 준 transcript를 지켜보다가 이벤트로 바꿔 넣는다.
function followTranscripts(payload: Record<string, unknown>) {
  const sessionId = payload.session_id;
  if (typeof sessionId !== "string" || !sessionId) return;
  // /office close로 끊은 세션도 transcript를 더 읽을 필요가 없다. 다시 연결하면 다음 hook에서 다시 읽는다.
  if (payload.hook_event_name === "SessionEnd" || payload.hook_event_name === "OfficeDisconnect") {
    stopFollowing(sessionId);
    return;
  }

  // 연결하지 않았거나 끊은 세션의 transcript는 읽지 않는다.
  const session = store().state.sessions[sessionId];
  if (!session || session.closed) return;
  const transcript = payload.transcript_path;
  if (typeof transcript !== "string" || !transcript) return;
  // followTranscript는 같은 파일에 대해 처음 넘긴 콜백만 쓰므로, 아직 판단하지 못한 결과도 그 콜백이 들고 있는다.
  let reader = emptyReaderState();
  let interruptionReader: InterruptionReaderState = {};
  followTranscript(sessionId, transcript, (lines) => {
    const read = readCallOutcomes(reader, lines);
    reader = read.state;
    const interrupted = readTurnInterruptions(interruptionReader, lines);
    interruptionReader = interrupted.state;
    const forwardInterruption = (interruption: TurnInterruption) => {
      // 같은 줄에 결과와 중단이 있으면 실행 여부는 아직 pending이어도, 거절 여부와 호출 정보는 이미 읽었다.
      const callResult = read.outcomes.find((outcome) => outcome.toolUseId === interruption.toolUseId)
        ?? read.state.pending.find((result) => result.toolUseId === interruption.toolUseId);
      ingestHookEvent({
        hook_event_name: "TranscriptInterrupted", session_id: sessionId,
        interrupted_at: interruption.at, interruption_kind: interruption.kind,
        tool_use_id: interruption.toolUseId, tool_name: callResult?.toolName,
        tool_input: callResult?.toolInput, tool_started_at: callResult?.startedAt, rejected: callResult?.rejected,
      });
    };
    // 같이 읽은 새 모델 호출을 먼저 반영해, 더 오래된 중단으로 새 턴을 끝내지 않는다.
    const requestedAt = latestModelRequestAt(lines);
    if (requestedAt !== undefined) {
      ingestHookEvent({ hook_event_name: "TranscriptModelRequest", session_id: sessionId, requested_at: requestedAt });
    }
    // 결과를 먼저 반영하면 대상이 종료 상태가 되므로, 도구 중단은 호출이 열려 있을 때 판정한다.
    interrupted.interruptions.filter((interruption) => interruption.kind === "tool").forEach(forwardInterruption);
    const hooked = hookedIds(sessionId);
    for (const outcome of read.outcomes) {
      const contradicts = !outcome.executed && hooked.has(outcome.toolUseId);
      hooked.delete(outcome.toolUseId);
      ingestHookEvent({
        hook_event_name: contradicts ? "TranscriptUnreliable" : outcome.executed ? "TranscriptExecuted" : "TranscriptNotExecuted",
        session_id: sessionId,
        tool_use_id: outcome.toolUseId,
        tool_name: outcome.toolName,
        tool_input: outcome.toolInput,
        tool_started_at: outcome.startedAt,
        tool_response: { isAsync: outcome.async, agentId: outcome.agentId },
        rejected: outcome.rejected,
        failed: outcome.failed,
      });
    }
    // 백그라운드 sub-agent는 끝났다는 hook 이벤트가 없으므로, 끝났다는 알림을 같은 transcript에서 찾는다.
    for (const toolUseId of finishedTaskToolUseIds(lines)) {
      ingestHookEvent({ hook_event_name: "TranscriptTaskFinished", session_id: sessionId, tool_use_id: toolUseId });
    }
    // 일반 Esc 중단은 결과 표시를 보존한 뒤 시각으로 판정한다. 시각이 없어도 관측 이벤트는 남긴다.
    interrupted.interruptions.filter((interruption) => interruption.kind === "turn").forEach(forwardInterruption);
  });
}

// 호스팅 주소와 보내기 토큰이 설정되어 있으면, 줄인 상태를 호스팅으로 올리는 전달기를 켠다.
// 서버가 켜질 때 한 번 부르며, 여러 번 불러도 하나만 돈다.
type RelayGlobal = typeof globalThis & { __officeRelay?: ReturnType<typeof createRelay> };

export function startHostedRelayFromEnv(): void {
  const config = relayConfigFromEnv(process.env, hostname());
  const g = globalThis as RelayGlobal;
  if (!config || g.__officeRelay) return;
  g.__officeRelay = createRelay({ ...config, getState: () => officeSnapshot(), subscribe: subscribeOffice });
  g.__officeRelay.start();
}

export function officeSnapshot(now = Date.now()): OfficeState {
  const s = store();
  s.state = pruneOfficeState(s.state, now);
  return s.state;
}

export function subscribeOffice(listener: Listener): () => void {
  const s = store();
  s.listeners.add(listener);
  return () => s.listeners.delete(listener);
}

// 거절 후 일정 시간이 지나면 이벤트가 없어도 화면에 정리된 상태를 알린다.
export function pruneAndNotify(now = Date.now()): void {
  const s = store();
  const next = pruneOfficeState(s.state, now);
  if (next === s.state) return;
  s.state = next;
  notify();
}

function notify() {
  const s = store();
  s.listeners.forEach((listener) => listener(s.state));
}
