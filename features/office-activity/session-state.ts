import type {
  Character,
  CharacterKind,
  OfficeState,
  Session,
} from "./types";
import { applyPlanCall, isPlanTool } from "./task-plan";
import { codexInputMatches } from "./codex-input";

type Payload = Record<string, unknown>;

// 허용되거나 거절된 캐릭터가 퇴근 장면을 보여줄 시간. 판단이 아니라 화면 정리에만 쓴다.
const ENDED_KEEP_MS = 8_000;
// 같은 허용 요청이 여러 hook으로 들어오는 간격(실제 20ms 안팎)보다 넉넉하고, 허용 창이 닫히고 다음 창이 뜨는 간격보다 짧다.
const DUPLICATE_REQUEST_MS = 1_000;
const LABEL_MAX = 40;
// 탭에서 내린 세션을 되살리려고 기억해 두는 최대 개수
const RETIRED_MAX = 20;
// task 목록에 반영한 호출을 기억해 두는 개수. 같은 호출의 두 신호는 몇 초 안에 오므로 몇 개면 충분하다.
const PLAN_CALLS_MAX = 20;

export function emptyOfficeState(): OfficeState {
  return { sessions: {}, order: [] };
}

export function applyHookEvent(
  state: OfficeState,
  payload: Payload,
  now: number
): OfficeState {
  const sessionId = text(payload.session_id);
  if (!sessionId) return state;

  const eventName = text(payload.hook_event_name);
  const revived = state.sessions[sessionId] ? undefined : state.retired?.[sessionId];
  // 이 이벤트들은 /office로 연결하지 않은 세션에서도 온다. 사무실이 알고 있는 세션의 것만 받는다.
  const known = state.sessions[sessionId] ?? revived;
  // Codex는 실제 턴 id를 준다. 늦게 도착한 지난 턴의 종료로 새 턴을 끝내지 않는다.
  if (known?.source === "codex" && eventName === "Stop" &&
    (!payload.turn_id || (known.turnId && payload.turn_id !== known.turnId))) return state;
  if (eventName && ONLY_KNOWN_SESSIONS.has(eventName) && !known) return state;
  // /office close로 연결을 끊은 세션은 hook이 계속 오더라도, 다시 연결하기 전까지 아무것도 반영하지 않는다.
  if (known?.closed && eventName !== "OfficeConnect") return state;
  if (eventName === "OfficeDisconnect" && !known) return state;
  let session = pruneEnded(
    state.sessions[sessionId] ?? revived ?? newSession(sessionId, payload, eventName),
    now
  );
  session = withProject(withCwd(withName(session, payload), payload), payload);
  if (eventName && CARRIES_CALL_ID.has(eventName)) session = adoptOrphan(session, payload);

  switch (eventName) {
    case "CodexActivitySource": {
      if (known?.source !== "codex") return state;
      const source = payload.activity_source;
      if (source !== "hooks" && source !== "transcript" && source !== "unavailable") return state;
      session = { ...session, codexActivitySource: source,
        ...(source === "hooks" ? { codexHookTurnId: text(payload.turn_id) ?? session.turnId } : {}),
        characters: source === "hooks" ? session.characters.filter((c) => c.activityOrigin !== "transcript") : session.characters };
      break;
    }
    case "CodexTranscriptSuperseded":
      if (known?.source !== "codex" || !text(payload.turn_id)) return state;
      // 다음 턴으로 넘어간 사실만 확인했다. 거절이나 Esc로 단정하지 않고 이전 기록 호출만 닫는다.
      session = closeCalls(session, (c) => c.activityOrigin === "transcript" && c.turnId === payload.turn_id, now);
      break;
    case "OfficeConnect":
      session = { ...session, connected: true, closed: false };
      break;
    // 세션이 끝난 것처럼 남은 캐릭터를 모두 내보내고, 이후 이벤트는 위에서 버린다.
    case "OfficeDisconnect":
      session = { ...finishAll(session), connected: false, priorUnknown: false, inTurn: false, closed: true };
      break;
    case "UserPromptSubmit":
      if (session.source === "codex" && text(payload.turn_id) && payload.turn_id !== session.codexHookTurnId) {
        session = { ...session, codexActivitySource: payload.activity_source === "transcript" ? "transcript"
          : payload.activity_source === "hooks" ? "hooks" : "unavailable" };
      }
      session = {
        ...session,
        connected: true,
        inTurn: true,
        turnActivityAt: now,
        ...(session.source === "codex" && text(payload.turn_id) ? { turnId: text(payload.turn_id) } : {}),
      };
      break;
    case "PreToolUse":
      if (!session.characters.some((c) => c.id === text(payload.tool_use_id))) {
        session = { ...session, connected: true, characters: [...session.characters, startCharacter(payload, now)] };
      }
      // 턴 시작(UserPromptSubmit)을 놓친 세션도 도구 호출을 보면 턴 중인 것을 안다.
      session = { ...session, inTurn: true, ...(!text(payload.agent_id) ? { turnActivityAt: now } : {}) };
      if (session.source === "codex" && text(payload.turn_id)) session = { ...session, turnId: text(payload.turn_id) };
      break;
    case "UserPromptExpansion":
      session = { ...session, connected: true, characters: addSlashSkill(session.characters, payload, now) };
      break;
    case "PermissionRequest":
      session = markWaiting(session, payload, now);
      // PreToolUse를 놓친 호출도 새 허용 요청을 받았다면 이전 턴의 중단으로 지우지 않는다.
      if (!text(payload.agent_id)) session = { ...session, turnActivityAt: now };
      break;
    // 거절과 중단은 추정하지 않는다. 다음 신호만 쓰고, 모두 tool_use_id로 캐릭터를 찾는다.
    // PermissionDenied: auto 모드 분류기가 거절했다는 hook.
    // TranscriptNotExecuted: 서버가 transcript에서 읽은 "실행되지 않은 호출". 결과 줄 다음에
    // PostToolUse hook 기록이 없으면 실행되지 않은 것이며, 사무실 서버의 응답 시점과는 상관없다.
    // 실행되지 않은 까닭은 거절만이 아니므로, 결과에 거절의 증거(rejected)가 있을 때만 거절로 보고
    // 나머지는 중단으로 본다. transcript를 믿을 수 없게 된 세션에서는 이 신호를 쓰지 않는다.
    case "PermissionDenied":
      session = endUnexecuted(session, text(payload.tool_use_id), "denied", now);
      break;
    case "CodexRejectedCall": {
      if (session.source !== "codex" || typeof payload.wrapper_call_id !== "string" ||
        session.codexRejectionIds?.includes(payload.wrapper_call_id) ||
        !Array.isArray(payload.commands) || !Array.isArray(payload.candidate_ids) ||
        typeof payload.started_at !== "number" || typeof payload.completed_at !== "number") return state;
      const matches = session.characters.filter((c) => !c.agentId && !c.background &&
        c.turnId === payload.turn_id && c.toolName === "Bash" &&
        ["working", "waiting", "cancelled"].includes(c.status) &&
        c.since >= (payload.started_at as number) && c.since <= (payload.completed_at as number) &&
        (payload.candidate_ids as string[]).includes(c.id) &&
        (payload.commands as string[]).some((command) => codexInputMatches("Bash", { command }, c.toolInput)));
      if (matches.length !== 1) return state;
      const target = matches[0];
      session = {
        ...session,
        codexRejectionIds: [...(session.codexRejectionIds ?? []), payload.wrapper_call_id],
        doneCount: session.doneCount + (target.status === "cancelled" ? 0 : 1),
        characters: session.characters.map((c) => c === target ?
          { ...c, status: "denied", endedAt: c.endedAt ?? now } : c),
      };
      break;
    }
    case "CodexDeclined":
    case "CodexExecuted": {
      if (session.source !== "codex") break;
      const id = text(payload.tool_use_id);
      let target = session.characters.find((c) => c.id === id);
      if (!target && payload.turn_id && payload.tool_name) {
        const matches = session.characters.filter((c) => c.orphan && c.turnId === payload.turn_id &&
          c.toolName === payload.tool_name && typeof payload.completed_at === "number" &&
          Number.isFinite(payload.completed_at) && c.waitingAt !== undefined && payload.completed_at >= c.waitingAt &&
          codexInputMatches(c.toolName, payload.tool_input, c.toolInput));
        if (matches.length === 1) target = matches[0];
      }
      if (!id || !target || target.status === "approved" || target.status === "denied") break;
      // Esc 뒤에도 백그라운드 명령이 완료될 수 있다. 중단 전 완료라는 증거가 있을 때만 턴의 중단 표시를 보정한다.
      if (eventName === "CodexExecuted" && target.interruptedAt !== undefined &&
        (typeof payload.completed_at !== "number" || payload.completed_at >= target.interruptedAt)) break;
      // 실행 중인 호출은 hook과 같은 경로로 정리해, 동일 입력의 잘못 붙은 허용 대기도 바로잡는다.
      if (eventName === "CodexExecuted" && target.status !== "cancelled") {
        session = {
          ...session,
          characters: session.characters.map((c) => c === target ? {
            ...c, id, sceneId: c.sceneId ?? c.id, orphan: false,
          } : c),
        };
        session = finishCall(session, id, now);
        break;
      }
      const counted = target.status === "cancelled";
      const doneCount = session.doneCount + (counted ? 0 : 1);
      session = {
        ...session,
        doneCount,
        characters: session.characters.map((c) => c === target ? {
          ...c, id, sceneId: c.sceneId ?? c.id, orphan: false,
          status: eventName === "CodexDeclined" ? "denied" : "approved", endedAt: c.endedAt ?? now,
        } : c),
      };
      break;
    }
    case "TranscriptNotExecuted":
      if (!session.transcriptUnreliable) {
        session = endUnexecuted(session, text(payload.tool_use_id), payload.rejected === true ? "denied" : "cancelled", now);
      }
      break;
    // 서버가 Post hook을 받은 호출을 transcript가 "실행되지 않음"으로 읽었다. 판단기가 바뀐 형식을
    // 잘못 읽고 있다는 뜻이므로, 이 세션에서는 실행되지 않았다는 transcript 판단을 더 쓰지 않는다.
    case "TranscriptUnreliable":
      session = { ...session, transcriptUnreliable: true };
      break;
    // 실행되었다는 신호. hook이 바로 오거나, hook이 늦거나 실패해도 transcript의 기록으로 온다.
    // 둘 다 오면 먼저 온 쪽이 정하고 나중 것은 아무것도 바꾸지 않는다.
    case "PostToolUse":
    case "PostToolUseFailure":
    case "TranscriptExecuted":
      // 실패한 호출은 목록을 바꾸지 못했다. transcript로 온 실행 신호도 실패 기록이면 반영하지 않는다.
      if (eventName !== "PostToolUseFailure" && payload.failed !== true) session = withPlanCall(session, payload);
      // 백그라운드로 시작한 sub-agent는 응답이 시작만 알린다. 끝났다는 hook 이벤트는 오지 않으므로
      // 캐릭터를 남겨 두고, 서버가 transcript에서 찾은 TranscriptTaskFinished에서 정리한다.
      if (isAsyncLaunch(payload)) session = markBackground(session, payload);
      else session = finishCall(session, text(payload.tool_use_id), now);
      break;
    // 백그라운드 sub-agent가 끝나면 그 안의 허용 창도 닫혔다. 그 sub-agent의 남은 호출도 함께 정리한다.
    case "TranscriptTaskFinished": {
      const finished = session.characters.find((c) => c.id === text(payload.tool_use_id))?.launchedAgentId;
      session = finishCall(session, text(payload.tool_use_id), now);
      if (finished) session = closeCalls(session, (c) => c.agentId === finished, now);
      break;
    }
    // 턴이 끝나면 본 세션과 포그라운드 sub-agent의 허용 창은 닫혔다. 아직 일하는 백그라운드
    // sub-agent 안의 호출만 남긴다. Esc로 중단한 턴은 Stop hook 없이 끝나 서버가 transcript로 알려 준다.
    case "Stop":
    case "TranscriptInterrupted": {
      let endedAt = now;
      if (eventName === "TranscriptInterrupted") {
        const at = payload.interrupted_at;
        if (typeof at !== "number" || !Number.isFinite(at) ||
          at < (session.turnActivityAt ?? 0) || at <= (session.turnEndedAt ?? 0)) break;
        if (payload.interruption_kind === "tool") {
          const target = interruptedMainCall(session, payload);
          if (!target) break;
          // 턴 종료 시각을 갱신하기 전에 id를 이어 붙여, 뒤따르는 결과에서도 같은 호출로 알아본다.
          if (target.orphan) session = adoptOrphan(session, payload);
          session = endUnexecuted(session, text(payload.tool_use_id), payload.rejected === true ? "denied" : "cancelled", now);
        }
        endedAt = at;
      }
      const running = runningBackgroundAgents(session);
      if (session.source === "codex" && payload.stop_reason === "interrupt") {
        session = { ...session, characters: session.characters.map((c) =>
          isActive(c) && (!c.agentId || !running.has(c.agentId)) ? { ...c, interruptedAt: now } : c) };
      }
      session = closeCalls(session, (c) => !c.agentId || !running.has(c.agentId), now);
      // 진행 중이던 턴이 끝났으면 도구를 부르지 않고 답만 했어도 일을 한 번 마친 것이다.
      session = { ...session, priorUnknown: false, inTurn: false, turnEndedAt: endedAt, ...(session.inTurn ? { answered: true } : {}) };
      break;
    }
    case "SessionEnd":
      session = { ...(session.source === "codex" ? closeCalls(session, () => true, now) : finishAll(session)), connected: false, priorUnknown: false, inTurn: false, turnEndedAt: now };
      break;
    // transcript는 주기적으로 읽어서 턴의 마지막 모델 호출 기록을 Stop보다 늦게 읽을 수 있다.
    // 마지막으로 턴이 끝난 뒤에 시작한 호출일 때만 턴이 진행 중이라고 본다.
    case "TranscriptModelRequest": {
      const at = typeof payload.requested_at === "number" ? payload.requested_at : undefined;
      if (at !== undefined && at > (session.turnEndedAt ?? 0)) {
        session = { ...session, inTurn: true, turnActivityAt: Math.max(session.turnActivityAt ?? 0, at) };
      }
      break;
    }
    default:
      session = { ...session, connected: true };
  }

  session = { ...session, lit: isLit(session) };
  let base = revived ? withoutRetired(state, sessionId) : state;
  if (eventName === "OfficeConnect") base = retireReplaced(base, session);
  return {
    ...base,
    sessions: { ...base.sessions, [sessionId]: session },
    order: base.order.includes(sessionId) ? base.order : [...base.order, sessionId],
  };
}

// /clear는 같은 폴더에서 새 세션을 시작한다. 그때 스킬 hook이 먼저 사라져 이전 세션의 SessionEnd가
// 오지 않으므로, 같은 전체 경로에서 새 세션이 연결되면 일하거나 허용을 기다리는 캐릭터가 없는 이전 세션을
// 탭에서 내린다. 도구 없이 생각하며 턴을 진행 중인 세션도 일하는 중이므로 남긴다. 폴더 이름만 같은 다른 저장소의 세션은 건드리지 않는다. 같은 폴더에서 세션 둘을 함께 쓰는
// 중이었다면, 내린 세션이 다음 이벤트를 보낼 때 그동안의 상태 그대로 되살린다.
function retireReplaced(state: OfficeState, incoming: Session): OfficeState {
  if (!incoming.cwd) return state;
  const ids = state.order.filter((id) => {
    const other = state.sessions[id];
    return id !== incoming.id && other?.cwd === incoming.cwd && other.source === incoming.source && !other.inTurn && !other.characters.some(isActive);
  });
  if (!ids.length) return state;
  const sessions = { ...state.sessions };
  const retired = { ...state.retired };
  for (const id of ids) {
    retired[id] = sessions[id];
    delete sessions[id];
  }
  const kept = Object.keys(retired).slice(-RETIRED_MAX);
  return {
    ...state,
    sessions,
    order: state.order.filter((id) => !ids.includes(id)),
    retired: Object.fromEntries(kept.map((id) => [id, retired[id]])),
  };
}

function withoutRetired(state: OfficeState, id: string): OfficeState {
  const retired = { ...state.retired };
  delete retired[id];
  return { ...state, retired };
}

// 도구 중단은 해당 호출만 근거로 삼는다. 다른 새 허용 대기는 턴 종료의 근거가 아니다.
function interruptedMainCall(session: Session, payload: Payload): Character | undefined {
  const id = text(payload.tool_use_id);
  if (!id || isPastTurnCall(session, payload)) return undefined;
  const known = session.characters.find((c) => c.id === id);
  // id 없는 ?는 도구·입력뿐 아니라 호출 시각도 확인해야 옛 호출에 잘못 붙이지 않는다.
  if (!known && typeof payload.tool_started_at !== "number") return undefined;
  const target = known ?? [...session.characters].reverse().find((c) =>
    c.orphan && !c.agentId && c.status === "waiting" && c.toolName === text(payload.tool_name) &&
    stable(c.toolInput) === stable(payload.tool_input)
  );
  return target && !target.agentId && !target.background && isActive(target) ? target : undefined;
}

function isPastTurnCall(session: Session, payload: Payload): boolean {
  return typeof payload.tool_started_at === "number" && payload.tool_started_at <= (session.turnEndedAt ?? 0);
}

function isActive(c: Character): boolean {
  return c.status === "working" || c.status === "waiting";
}

// 이벤트가 오지 않아도 퇴근 장면이 끝난 캐릭터를 정리한다.
export function pruneOfficeState(state: OfficeState, now: number): OfficeState {
  let changed = false;
  const sessions: Record<string, Session> = {};
  for (const [id, session] of Object.entries(state.sessions)) {
    const pruned = pruneEnded(session, now);
    if (pruned !== session) changed = true;
    sessions[id] = pruned === session ? session : { ...pruned, lit: isLit(pruned) };
  }
  return changed ? { ...state, sessions } : state;
}

// 연결 신호가 아닌 이벤트로 처음 알게 된 세션은, 서버가 그 앞의 일(허용 대기 포함)을 보지 못한 것이다.
function newSession(id: string, payload: Payload, eventName: string | undefined): Session {
  return {
    id,
    ...(payload.source === "codex" ? { source: "codex" as const } : {}),
    name: sessionName(payload) ?? id.slice(0, 8),
    connected: false,
    lit: false,
    doneCount: 0,
    priorUnknown: eventName !== "OfficeConnect",
    characters: [],
  };
}

function withName(session: Session, payload: Payload): Session {
  const name = sessionName(payload);
  return name && name !== session.name ? { ...session, name } : session;
}

function withCwd(session: Session, payload: Payload): Session {
  const cwd = text(payload.cwd);
  return cwd && cwd !== session.cwd ? { ...session, cwd } : session;
}

// project_root는 사무실 서버가 cwd로 찾아 hook 이벤트에 붙인 저장소 경로다.
function withProject(session: Session, payload: Payload): Session {
  const root = text(payload.project_root);
  return root && root !== session.projectRoot ? { ...session, projectRoot: root, project: lastSegment(root) ?? root } : session;
}

function sessionName(payload: Payload): string | undefined {
  return text(payload.project) ?? lastSegment(text(payload.cwd));
}

// 퇴근 중인(approved, denied, cancelled) 캐릭터는 불을 켜 두지 않는다. 화면은 그 캐릭터가 문을 나갈 때까지 불을 유지한다.
// 턴이 진행 중이면 도구 호출 사이(Claude가 생각하는 동안)에도 켜 둔다. 그래야 불 꺼짐이 "지시한 일이 모두 끝남"을 뜻한다.
// 그전 상태를 모르는 세션은 남은 허용 대기가 있을 수 있으므로 "모두 끝남"을 뜻하는 불 꺼짐을 보이지 않는다.
function isLit(session: Session): boolean {
  const active = session.characters.some(isActive);
  const idleSinceConnect = session.source !== "codex" && session.doneCount === 0 && !session.answered;
  return session.connected && (active || session.inTurn === true || idleSinceConnect || session.priorUnknown === true);
}

function isEnded(c: Character): boolean {
  return c.status === "approved" || c.status === "denied" || c.status === "cancelled";
}

function pruneEnded(session: Session, now: number): Session {
  const kept = session.characters.filter((c) => !(isEnded(c) && now - (c.endedAt ?? now) > ENDED_KEEP_MS));
  return kept.length === session.characters.length ? session : { ...session, characters: kept };
}

function startCharacter(payload: Payload, now: number): Character {
  const toolName = text(payload.tool_name) ?? "tool";
  const input = payload.tool_input;
  const agentId = text(payload.agent_id);
  return {
    id: text(payload.tool_use_id) ?? `${toolName}-${now}`,
    kind: kindOf(toolName),
    ...(payload.source === "codex" ? { turnId: text(payload.turn_id) } : {}),
    status: "working",
    label: labelOf(toolName, input),
    toolName,
    toolInput: input,
    since: now,
    ...(payload.activity_origin === "transcript" ? { activityOrigin: "transcript" as const } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

// 슬래시로 직접 입력한 skill은 Skill tool 호출 이벤트가 없어서 확장 이벤트로 알아낸다.
// 끝났다는 이벤트도 따로 없으므로 턴이 끝나는 Stop에서 정리한다. 연결용 /office는 보여주지 않는다.
function addSlashSkill(characters: Character[], payload: Payload, now: number): Character[] {
  const name = text(payload.command_name);
  if (text(payload.expansion_type) !== "slash_command" || !name || name === "office") return characters;
  const id = `slash-${text(payload.prompt_id) ?? now}`;
  if (characters.some((c) => c.id === id)) return characters;
  return [
    ...characters,
    { id, kind: "skill", status: "working", label: `skill · ${name}`, toolName: "Skill", toolInput: { skill: name }, since: now },
  ];
}

function kindOf(toolName: string): CharacterKind {
  if (toolName === "Skill") return "skill";
  if (toolName === "Agent" || toolName === "Task") return "sub";
  return "tool";
}

function labelOf(toolName: string, input: unknown): string {
  const fields = isRecord(input) ? input : {};
  if (toolName === "Skill") return `skill · ${text(fields.skill) ?? text(fields.name) ?? "skill"}`;
  if (toolName === "Agent" || toolName === "Task") {
    return `서브에이전트 · ${text(fields.subagent_type) ?? text(fields.description) ?? "agent"}`;
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName);
  if (mcp) return truncate(`${mcp[1]} · ${mcp[2]}`, LABEL_MAX);
  const target = targetOf(fields);
  return truncate(target ? `${toolName} · ${target}` : toolName, LABEL_MAX);
}

function targetOf(fields: Record<string, unknown>): string | undefined {
  const path = text(fields.file_path) ?? text(fields.path) ?? text(fields.notebook_path);
  if (path) return lastSegment(path);
  const url = text(fields.url);
  if (url) return url.replace(/^https?:\/\//, "");
  return text(fields.command) ?? text(fields.pattern) ?? text(fields.query) ?? text(fields.description);
}

function markWaiting(session: Session, payload: Payload, now: number): Session {
  const toolName = text(payload.tool_name);
  const key = stable(payload.tool_input);
  // 같은 허용 요청이 hook 여러 벌(예전 /office 스킬 hook과 프로젝트 설정 hook)로 거의 동시에 들어올 수 있다.
  // 허용 창은 한 번에 하나씩 뜨므로, 같은 도구와 입력으로 방금 회의실에 들어간 캐릭터가 있으면 같은 요청이다.
  const agentId = text(payload.agent_id);
  const duplicate = session.characters.some(
    (c) =>
      c.status === "waiting" &&
      c.toolName === toolName &&
      c.agentId === agentId &&
      stable(c.toolInput) === key &&
      now - (c.waitingAt ?? 0) < DUPLICATE_REQUEST_MS
  );
  if (duplicate) return session;
  // sub-agent 안의 호출은 PreToolUse가 오지 않아 사무실에 캐릭터가 없다. 본 세션의 캐릭터와 짝짓지 않고
  // 허용 요청만으로 ? 캐릭터를 만든다.
  if (agentId) return toolName ? withOrphan(session, payload, now, agentId) : session;
  // 허용 요청에는 tool_use_id가 없어 도구 이름과 입력으로 짝짓는다. Claude Code는 호출을 시작하며
  // PreToolUse를 보낸 직후 그 호출의 허용을 묻는다(실제 세션 33건 모두 가장 최근에 시작한 호출이었고,
  // 간격은 19–127ms). 그래서 가장 최근에 시작한 호출부터 짝짓는다. 입력이 같은 호출끼리 짝이
  // 틀려도 finishCall이 실제로 실행된 호출로 바로잡는다.
  const open = session.characters.filter(
    (c) => c.status === "working" && !c.background && c.agentId === agentId && c.toolName === toolName
  );
  // 입력 표현이 달라 같은 입력을 못 찾아도, 허용 대기를 놓치는 것이 더 나쁘므로 가장 최근 호출로 짝짓는다.
  const target = [...open].reverse().find((c) => stable(c.toolInput) === key) ?? open[open.length - 1];
  if (target) return replace(session, target.id, { status: "waiting", waitingAt: now });

  // 짝지을 캐릭터가 없다는 것은 서버가 그 호출의 PreToolUse hook을 놓쳤다는 뜻이다(서버 오류, 재시작 등).
  // 허용 창은 떠 있으므로 허용 요청의 도구와 입력으로 허용 대기 캐릭터를 만든다. 진짜 tool_use_id는
  // 그 호출의 다음 신호가 올 때 adoptOrphan이 이어 붙인다.
  if (!toolName) return session;
  return withOrphan(session, payload, now);
}

function withOrphan(session: Session, payload: Payload, now: number, agentId?: string): Session {
  const orphan: Character = {
    ...startCharacter(payload, now),
    id: `permission-${now}-${session.characters.length}`,
    status: "waiting",
    waitingAt: now,
    orphan: true,
    ...(agentId ? { agentId } : {}),
  };
  return { ...session, connected: true, characters: [...session.characters, orphan] };
}

// 사무실이 이미 아는 세션에만 반영하는 이벤트.
// - 프로젝트·사용자 설정에 걸린 hook: sub-agent 안의 호출까지 받으려고 설정에 두어서, 연결하지 않은 세션에서도 온다.
//   나머지 hook은 /office 스킬에 걸려 연결한 세션에서만 온다.
// - 서버가 transcript에서 읽어 만든 이벤트: 연결하지 않은 세션의 transcript에서 나왔을 수 있다.
const ONLY_KNOWN_SESSIONS = new Set([
  "PermissionRequest",
  "PermissionDenied",
  "CodexDeclined",
  "CodexExecuted",
  "CodexRejectedCall",
  "PostToolUse",
  "PostToolUseFailure",
  "TranscriptExecuted",
  "TranscriptNotExecuted",
  "TranscriptUnreliable",
  "TranscriptTaskFinished",
  "TranscriptInterrupted",
  "TranscriptModelRequest",
]);

// tool_use_id를 담고 오는 신호들. 이 id를 모르는 캐릭터에게 이어 붙일 수 있다.
const CARRIES_CALL_ID = new Set([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionDenied",
  "TranscriptExecuted",
  "TranscriptNotExecuted",
]);

// 처음 보는 tool_use_id의 신호가 오면, 같은 도구와 입력으로 만들어 둔 id 없는 허용 대기 캐릭터에 이어 붙인다.
function adoptOrphan(session: Session, payload: Payload): Session {
  const id = text(payload.tool_use_id);
  const toolName = text(payload.tool_name);
  if (!id || !toolName || session.characters.some((c) => c.id === id)) return session;
  if (isPastTurnCall(session, payload)) return session;
  const key = stable(payload.tool_input);
  // sub-agent 안의 호출은 허용 없이 끝나는 것도 Post hook이 오므로, 같은 sub-agent의 입력이 같은 ?에만 이어 붙인다.
  const agentId = text(payload.agent_id);
  const orphans = session.characters.filter((c) => c.orphan && c.toolName === toolName && c.agentId === agentId);
  const sameInput = [...orphans].reverse().find((c) => session.source === "codex"
    ? codexInputMatches(toolName, payload.tool_input, c.toolInput)
    : stable(c.toolInput) === key);
  const orphan = agentId ? sameInput : (sameInput ?? orphans[orphans.length - 1]);
  if (!orphan) return session;
  return {
    ...session,
    characters: session.characters.map((c) => (c === orphan ? { ...c, id, orphan: false, ...(session.source === "codex" ? { sceneId: c.sceneId ?? c.id } : {}) } : c)),
  };
}

function runningBackgroundAgents(session: Session): Set<string> {
  return new Set(
    session.characters.flatMap((c) => (c.background && c.status === "working" && c.launchedAgentId ? [c.launchedAgentId] : []))
  );
}

// 허용 창이 닫힌 호출을 정리한다. transcript를 읽지 못해도, 그때까지 실행되지 않은 허용 대기 호출은
// 실행되지 않은 것이다. 거절의 증거는 없으므로 중단으로 본다. 일하던 호출은 끝난 것으로 내보내고,
// 백그라운드 sub-agent 캐릭터와 퇴근 중인 캐릭터는 남긴다.
function closeCalls(session: Session, closing: (c: Character) => boolean, now: number): Session {
  const waiting = (c: Character) => c.status === "waiting" && closing(c);
  const working = (c: Character) => c.status === "working" && !c.background && closing(c);
  const count = session.characters.filter((c) => waiting(c) || working(c)).length;
  if (!count) return session;
  return {
    ...session,
    characters: session.characters
      .filter((c) => session.source === "codex" || !working(c))
      .map((c) => (waiting(c) || (session.source === "codex" && working(c)) ? { ...c, status: "cancelled", endedAt: now } : c)),
    doneCount: session.doneCount + count,
  };
}

// 아직 끝나지 않은 호출만 거절로 바꾼다. 이미 Post hook으로 끝났거나 백그라운드로 도는 호출은 그대로 둔다.
function endUnexecuted(session: Session, id: string | undefined, status: "denied" | "cancelled", now: number): Session {
  const target = session.characters.find((c) => c.id === id);
  if (!target || !(target.status === "waiting" || (target.status === "working" && !target.background))) return session;
  return { ...replace(session, target.id, { status, endedAt: now }), doneCount: session.doneCount + 1 };
}

function isAsyncLaunch(payload: Payload): boolean {
  const response = payload.tool_response;
  return isRecord(response) && response.isAsync === true;
}

// 호출이 실행되어 끝났다. 허용 대기였던 호출은 허용된 것이므로 퇴근 장면을 위해 approved로 남긴다.
function finishCall(session: Session, id: string | undefined, now: number): Session {
  const target = session.characters.find((c) => c.id === id);
  if (!target || isEnded(target)) return session;
  const done = { ...session, doneCount: session.doneCount + 1 };
  const misplaced = target.status === "working" && !target.background ? waitingTwin(session, target) : undefined;
  if (target.status === "waiting" || misplaced) {
    const fixed = misplaced ? replace(done, misplaced.id, { status: "working", waitingAt: undefined }) : done;
    return replace(fixed, target.id, { status: "approved", endedAt: now });
  }
  return { ...done, characters: session.characters.filter((c) => c.id !== target.id) };
}

// 같은 agent의 입력이 같은 호출은 권한 규칙이 똑같이 적용되므로 둘 다 허용이 필요하다. 그런데 회의실에 있지 않던
// 호출이 실행되었다면, 허용 요청을 받은 것은 이 호출이었다. 회의실에 잘못 보낸 같은 입력의 호출을 찾는다.
function waitingTwin(session: Session, target: Character): Character | undefined {
  const key = stable(target.toolInput);
  return session.characters.find(
    (c) => c.id !== target.id && c.status === "waiting" && c.agentId === target.agentId &&
      c.toolName === target.toolName && stable(c.toolInput) === key
  );
}

// 세션이 끝나면 남은 호출은 모두 나간다. 허용 여부를 알 수 없으므로 허용 대기도 그냥 나가게 한다.
function finishAll(session: Session): Session {
  const open = session.characters.filter((c) => !isEnded(c));
  return {
    ...session,
    characters: session.characters.filter(isEnded),
    doneCount: session.doneCount + open.length,
  };
}

// task 목록을 고치는 호출이 실행되었으면 목록에 반영한다. 같은 호출은 Post hook과 transcript 기록으로 두 번 올 수 있어,
// advance처럼 지금 목록에 기대는 입력이 두 번 적용되지 않게 반영한 id를 기억한다.
function withPlanCall(session: Session, payload: Payload): Session {
  const toolName = text(payload.tool_name);
  const id = text(payload.tool_use_id);
  if (!toolName || !isPlanTool(toolName) || !id || session.planCallIds?.includes(id)) return session;
  const plan = applyPlanCall(session.plan, toolName, payload.tool_input);
  const planCallIds = [...(session.planCallIds ?? []), id].slice(-PLAN_CALLS_MAX);
  const next: Session = { ...session, planCallIds, plan };
  if (!plan) delete next.plan;
  return next;
}

function markBackground(session: Session, payload: Payload): Session {
  const id = text(payload.tool_use_id);
  if (!id) return session;
  const response = payload.tool_response;
  const launchedAgentId = isRecord(response) ? text(response.agentId) : undefined;
  return replace(session, id, { background: true, ...(launchedAgentId ? { launchedAgentId } : {}) });
}

function replace(session: Session, id: string, patch: Partial<Character>): Session {
  return {
    ...session,
    characters: session.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lastSegment(path: string | undefined): string | undefined {
  return path?.split(/[\\/]/).filter(Boolean).pop();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((k) => `${k}:${stable(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
