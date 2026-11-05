import type { Character, OfficeState, Session } from "../types";

// 호스팅으로 보내기 전에 상태를 줄인다. PC를 떠나는 것은 호출의 상태와 종류, 도구 이름, 파일 이름,
// skill과 sub-agent 이름뿐이고, 명령 내용, URL, 검색어, 프롬프트, task 목록, 전체 경로는 남기지 않는다.
// ([local-first-deployment] 결정과 hosted-personal-view 스펙의 "보내는 내용")

const LABEL_MAX = 40;
// 이 도구들만 입력의 파일 경로에서 파일 이름을 라벨로 쓴다. 다른 도구의 path는 폴더일 수 있어 쓰지 않는다.
const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function redactState(state: OfficeState): OfficeState {
  const sessions: Record<string, Session> = {};
  for (const [id, session] of Object.entries(state.sessions)) {
    // 로컬 화면처럼 퇴근 캐릭터가 남은 종료 세션은 보내고, 완전히 비면 빼서 누적되지 않게 한다.
    if (!session.connected && session.characters.length === 0) continue;
    const redacted: Session = { ...session, characters: session.characters.map(redactCharacter) };
    delete redacted.cwd;
    delete redacted.projectRoot;
    // task 문구는 Claude가 요청을 풀어 쓴 글이라 프롬프트처럼 할 일과 파일 이름이 그대로 담긴다. 호스팅 게시판은 원래 차트를 그린다.
    delete redacted.plan;
    delete redacted.planCallIds;
    sessions[id] = redacted;
  }
  // 탭에서 내린 세션은 로컬에서 되살리는 데만 쓴다.
  const redacted: OfficeState = { ...state, sessions, order: state.order.filter((id) => Object.hasOwn(sessions, id)) };
  delete redacted.retired;
  return redacted;
}

function redactCharacter({ agentId: _agentId, ...character }: Character): Character {
  return { ...character, label: hostedLabel(character), toolInput: null };
}

function hostedLabel(character: Character): string {
  if (character.kind === "skill") return truncate(character.label);
  if (character.kind === "sub") {
    const type = text(record(character.toolInput).subagent_type);
    return type ? truncate(`서브에이전트 · ${type}`) : "서브에이전트";
  }

  const mcp = /^mcp__(.+?)__(.+)$/.exec(character.toolName);
  if (mcp) return truncate(`${mcp[1]} · ${mcp[2]}`);

  if (FILE_TOOLS.has(character.toolName)) {
    const input = record(character.toolInput);
    const file = lastSegment(text(input.file_path) ?? text(input.notebook_path));
    if (file) return truncate(`${character.toolName} · ${file}`);
  }
  return truncate(character.toolName);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function lastSegment(path: string | undefined): string | undefined {
  return path?.split(/[\\/]/).filter(Boolean).pop();
}

function truncate(value: string): string {
  return value.length > LABEL_MAX ? `${value.slice(0, LABEL_MAX - 1)}…` : value;
}
