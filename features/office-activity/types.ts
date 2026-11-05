export type CharacterKind = "tool" | "skill" | "sub";

// working: 일하는 중, waiting: 허용 대기,
// approved: 허용되어 일을 마치고 퇴근 준비, denied: 사용자가 거절해 퇴근 준비,
// cancelled: 거절은 아니지만 실행되지 않고 끝나 퇴근 준비(중단, 만료, 권한 규칙 등)
export type CharacterStatus = "working" | "waiting" | "approved" | "denied" | "cancelled";

// 캐릭터 하나는 tool, skill, sub-agent 호출 한 건이다.
export type Character = {
  id: string;
  kind: CharacterKind;
  status: CharacterStatus;
  label: string;
  toolName: string;
  toolInput: unknown;
  since: number;
  // 서버가 PreToolUse hook을 놓쳐 허용 요청만으로 만든 캐릭터. 진짜 tool_use_id를 아직 모른다.
  orphan?: boolean;
  // 호출한 sub-agent의 id. 없으면 본 세션의 호출이다. 허용 요청을 짝지을 때 같은 소속끼리만 비교한다.
  agentId?: string;
  // 백그라운드로 시작한 sub-agent: 턴이 끝나도 계속 일하고, 끝났다는 알림이 올 때 나간다.
  background?: boolean;
  // 백그라운드로 시작한 sub-agent의 id(시작 응답의 agentId). 그 sub-agent 안의 호출이 가진 agentId와 같다.
  launchedAgentId?: string;
  waitingAt?: number;
  // approved, denied, cancelled가 된 시각. 퇴근 장면을 보여줄 시간이 지나면 목록에서 정리한다.
  endedAt?: number;
};

export type Session = {
  id: string;
  name: string;
  // 세션을 연 폴더의 전체 경로. /clear로 같은 곳에서 시작한 새 세션을 알아보는 데만 쓰고, 호스팅으로는 보내지 않는다.
  cwd?: string;
  // 세션을 연 폴더가 속한 저장소의 전체 경로. 워크트리에서 연 세션도 원래 저장소로 묶는 데 쓰고, 호스팅으로는 보내지 않는다.
  projectRoot?: string;
  // 그 저장소의 폴더 이름. 같은 프로젝트의 세션을 한 사무실 탭으로 묶어 보여줄 때 탭 이름이 된다.
  project?: string;
  connected: boolean;
  // /office close로 연결을 끊었다. 다시 /office로 연결하기 전까지 이 세션의 이벤트를 반영하지 않는다.
  closed?: boolean;
  // 세션이 연결되어 있고, 아직 일이 없었거나, 턴이 진행 중이거나, 일하거나 기다리는 캐릭터가 있으면 사무실에 불이 켜진다.
  lit: boolean;
  // 사용자가 요청을 보낸 뒤(UserPromptSubmit) 턴이 끝날 때(Stop)까지. 도구 호출 사이에 생각하는 동안에도 불을 켜 둔다.
  inTurn?: boolean;
  // 본 세션의 진행을 마지막으로 확인한 시각. 이보다 오래된 중단 기록으로 현재 턴을 끝내지 않는다.
  turnActivityAt?: number;
  // 마지막으로 턴이 끝난 시각(Stop, 중단, 세션 종료). 그보다 앞서 시작한 모델 호출 기록으로 턴을 다시 켜지 않는다.
  turnEndedAt?: number;
  doneCount: number;
  // 서버가 이 세션의 시작(연결 신호)을 보지 못했다. 서버가 다시 켜지는 등으로 그전의 허용 대기를 모를 수 있다.
  // 턴이 끝나면(Stop) 남은 허용 창이 없으므로 다시 알게 된다.
  priorUnknown?: boolean;
  // transcript를 믿을 수 없게 된 세션. 실행되지 않았다는 판단을 쓰지 않는다.
  transcriptUnreliable?: boolean;
  characters: Character[];
  // 세션의 task 목록. 목록을 고치는 도구 호출(update_plan, TodoWrite)이 실행될 때마다 바뀌고, 없으면 게시판에 원래 차트를 그린다.
  plan?: PlanItem[];
  // 목록에 이미 반영한 호출의 tool_use_id. Post hook과 transcript 기록이 둘 다 와도 한 번만 반영한다.
  planCallIds?: string[];
};

export type PlanItemStatus = "pending" | "in_progress" | "completed";

export type PlanItem = {
  content: string;
  status: PlanItemStatus;
};

export type OfficeState = {
  sessions: Record<string, Session>;
  order: string[];
  // 같은 폴더의 새 세션 때문에 탭에서 내린 세션. 실제로는 살아 있던 세션이 다시 이벤트를 보내면 그대로 되살린다.
  retired?: Record<string, Session>;
  // 서버가 켜질 때마다 바뀌는 값. 화면은 이 값이 바뀌면 서버가 다시 켜진 것을 안다.
  instance?: string;
};
