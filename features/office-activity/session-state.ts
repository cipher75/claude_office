import type {
  Character,
  CharacterKind,
  OfficeState,
  Session,
} from "./types";

type Payload = Record<string, unknown>;

// 허용되거나 거절된 캐릭터가 퇴근 장면을 보여줄 시간. 판단이 아니라 화면 정리에만 쓴다.
const ENDED_KEEP_MS = 8_000;
// 같은 허용 요청이 여러 hook으로 들어오는 간격(실제 20ms 안팎)보다 넉넉하고, 허용 창이 닫히고 다음 창이 뜨는 간격보다 짧다.
const DUPLICATE_REQUEST_MS = 1_000;
const LABEL_MAX = 40;
// 탭에서 내린 세션을 되살리려고 기억해 두는 최대 개수
const RETIRED_MAX = 20;

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
  if (eventName && ONLY_KNOWN_SESSIONS.has(eventName) && !known) return state;
  // /office close로 연결을 끊은 세션은 hook이 계속 오더라도, 다시 연결하기 전까지 아무것도 반영하지 않는다.
  if (known?.closed && eventName !== "OfficeConnect") return state;
  if (eventName === "OfficeDisconnect" && !known) return state;
  let session = pruneEnded(
    state.sessions[sessionId] ?? revived ?? newSession(sessionId, payload, eventName),
    now
  );
  session = withCwd(withName(session, payload), payload);
  if (eventName && CARRIES_CALL_ID.has(eventName)) session = adoptOrphan(session, payload);

  switch (eventName) {
    case "OfficeConnect":
      session = { ...session, connected: true, closed: false };
      break;
    // 세션이 끝난 것처럼 남은 캐릭터를 모두 내보내고, 이후 이벤트는 위에서 버린다.
    case "OfficeDisconnect":
      session = { ...finishAll(session), connected: false, priorUnknown: false, inTurn: false, closed: true };
      break;
    case "UserPromptSubmit":
      session = { ...session, connected: true, inTurn: true };
      break;
    case "PreToolUse":
      if (!session.characters.some((c) => c.id === text(payload.tool_use_id))) {
        session = { ...session, connected: true, characters: [...session.characters, startCharacter(payload, now)] };
      }
      // 턴 시작(UserPromptSubmit)을 놓친 세션도 도구 호출을 보면 턴 중인 것을 안다.
      session = { ...session, inTurn: true };
      break;
    case "UserPromptExpansion":
      session = { ...session, connected: true, characters: addSlashSkill(session.characters, payload, now) };
      break;
    case "PermissionRequest":
      session = markWaiting(session, payload, now);
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
      // 백그라운드로 시작한 sub-agent는 응답이 시작만 알린다. 끝났다는 hook 이벤트는 오지 않으므로
      // 캐릭터를 남겨 두고, 서버가 transcript에서 찾은 TranscriptTaskFinished에서 정리한다.
      if (isAsyncLaunch(payload)) session = markBackground(session, text(payload.tool_use_id));
      else session = finishCall(session, text(payload.tool_use_id), now);
      break;
    case "TranscriptTaskFinished":
      session = finishCall(session, text(payload.tool_use_id), now);
      break;
    // 턴이 끝나면 본 세션의 허용 창은 남지 않으므로, 시작을 보지 못한 세션도 이제 상태를 안다.
    case "Stop":
      session = { ...finishWorking(cancelWaiting(session, now)), priorUnknown: false, inTurn: false };
      break;
    case "SessionEnd":
      session = { ...finishAll(session), connected: false, priorUnknown: false, inTurn: false };
      break;
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
// 탭에서 내린다. 폴더 이름만 같은 다른 저장소의 세션은 건드리지 않는다. 같은 폴더에서 세션 둘을 함께 쓰는
// 중이었다면, 내린 세션이 다음 이벤트를 보낼 때 그동안의 상태 그대로 되살린다.
function retireReplaced(state: OfficeState, incoming: Session): OfficeState {
  if (!incoming.cwd) return state;
  const ids = state.order.filter((id) => {
    const other = state.sessions[id];
    return id !== incoming.id && other?.cwd === incoming.cwd && !other.characters.some(isActive);
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

function sessionName(payload: Payload): string | undefined {
  return text(payload.project) ?? lastSegment(text(payload.cwd));
}

// 퇴근 중인(approved, denied, cancelled) 캐릭터는 불을 켜 두지 않는다. 화면은 그 캐릭터가 문을 나갈 때까지 불을 유지한다.
// 턴이 진행 중이면 도구 호출 사이(Claude가 생각하는 동안)에도 켜 둔다. 그래야 불 꺼짐이 "지시한 일이 모두 끝남"을 뜻한다.
// 그전 상태를 모르는 세션은 남은 허용 대기가 있을 수 있으므로 "모두 끝남"을 뜻하는 불 꺼짐을 보이지 않는다.
function isLit(session: Session): boolean {
  const active = session.characters.some(isActive);
  return session.connected && (active || session.inTurn === true || session.doneCount === 0 || session.priorUnknown === true);
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
  return {
    id: text(payload.tool_use_id) ?? `${toolName}-${now}`,
    kind: kindOf(toolName),
    status: "working",
    label: labelOf(toolName, input),
    toolName,
    toolInput: input,
    since: now,
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
  const open = session.characters.filter((c) => c.status === "working" && !c.background && c.toolName === toolName);
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
  "PostToolUse",
  "PostToolUseFailure",
  "TranscriptExecuted",
  "TranscriptNotExecuted",
  "TranscriptUnreliable",
  "TranscriptTaskFinished",
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
  const key = stable(payload.tool_input);
  // sub-agent 안의 호출은 허용 없이 끝나는 것도 Post hook이 오므로, 같은 sub-agent의 입력이 같은 ?에만 이어 붙인다.
  const agentId = text(payload.agent_id);
  const orphans = session.characters.filter((c) => c.orphan && c.toolName === toolName && c.agentId === agentId);
  const sameInput = [...orphans].reverse().find((c) => stable(c.toolInput) === key);
  const orphan = agentId ? sameInput : (sameInput ?? orphans[orphans.length - 1]);
  if (!orphan) return session;
  return {
    ...session,
    characters: session.characters.map((c) => (c === orphan ? { ...c, id, orphan: false } : c)),
  };
}

// transcript를 읽지 못했을 때를 위한 대비: 턴이 끝났다면 허용 창은 이미 닫혔고,
// 그때까지 실행되지 않은 허용 대기 호출은 실행되지 않은 것이다. 거절의 증거는 없으므로 중단으로 본다.
function cancelWaiting(session: Session, now: number): Session {
  const waiting = session.characters.filter((c) => c.status === "waiting").length;
  if (!waiting) return session;
  return {
    ...session,
    characters: session.characters.map((c) => (c.status === "waiting" ? { ...c, status: "cancelled", endedAt: now } : c)),
    doneCount: session.doneCount + waiting,
  };
}

// 일하던 호출만 끝난 것으로 정리하고, 퇴근 중인 캐릭터는 퇴근 장면을 위해 남긴다.
function finishWorking(session: Session): Session {
  const finishing = (c: Character) => c.status === "working" && !c.background;
  const working = session.characters.filter(finishing).length;
  return {
    ...session,
    characters: session.characters.filter((c) => !finishing(c)),
    doneCount: session.doneCount + working,
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

// 입력이 같은 호출은 권한 규칙이 똑같이 적용되므로 둘 다 허용이 필요하다. 그런데 회의실에 있지 않던
// 호출이 실행되었다면, 허용 요청을 받은 것은 이 호출이었다. 회의실에 잘못 보낸 같은 입력의 호출을 찾는다.
function waitingTwin(session: Session, target: Character): Character | undefined {
  const key = stable(target.toolInput);
  return session.characters.find(
    (c) => c.id !== target.id && c.status === "waiting" && c.toolName === target.toolName && stable(c.toolInput) === key
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

function markBackground(session: Session, id: string | undefined): Session {
  return id ? replace(session, id, { background: true }) : session;
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
