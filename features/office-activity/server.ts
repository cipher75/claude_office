import { hostname } from "node:os";

import { relayConfigFromEnv } from "./hosted/deployment";
import { createRelay } from "./hosted/relay";
import { recordRawEvent } from "./raw-event-log";
import { applyHookEvent, emptyOfficeState, pruneOfficeState } from "./session-state";
import { finishedTaskToolUseIds } from "./task-notification";
import { emptyReaderState, followTranscript, readCallOutcomes, stopFollowing } from "./transcript-watch";
import type { OfficeState } from "./types";

// 서버 전용 진입점: hook 이벤트를 받아 사무실 상태를 만들고, 화면에 알린다.

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
  const s = store();
  s.state = applyHookEvent(s.state, payload, now);
  notify();
  rememberHooked(payload);
  followTranscripts(payload);
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
  followTranscript(sessionId, transcript, (lines) => {
    const read = readCallOutcomes(reader, lines);
    reader = read.state;
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
        tool_response: { isAsync: outcome.async },
        rejected: outcome.rejected,
      });
    }
    // 백그라운드 sub-agent는 끝났다는 hook 이벤트가 없으므로, 끝났다는 알림을 같은 transcript에서 찾는다.
    for (const toolUseId of finishedTaskToolUseIds(lines)) {
      ingestHookEvent({ hook_event_name: "TranscriptTaskFinished", session_id: sessionId, tool_use_id: toolUseId });
    }
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
