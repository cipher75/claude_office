export type CharacterKind = "tool" | "skill" | "sub";

// working: 일하는 중, waiting: 허용 대기,
// approved: 허용되어 일을 마치고 퇴근 준비, denied: 사용자가 거절해 퇴근 준비,
// cancelled: 거절은 아니지만 실행되지 않고 끝나 퇴근 준비(중단, 만료, 권한 규칙 등)
export type CharacterStatus = "working" | "waiting" | "approved" | "denied" | "cancelled";

// 캐릭터 하나는 tool, skill, sub-agent 호출 한 건이다.
export type Character = {
  id: string;
  // 실제 호출 id를 복구해도 화면에서는 같은 캐릭터로 이어진다.
  sceneId?: string;
  activityOrigin?: "transcript";
  turnId?: string;
  kind: CharacterKind;
  status: CharacterStatus;
  label: string;
  // 사무실별로 합친 화면의 말풍선 제공자 표시. 세션 번호가 있으면 함께 표시한다.
  speaker?: string;
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
  // 명시적인 Interrupt로 멈춘 시각. hook 유실로 잠정 중단된 호출과 구분한다.
  interruptedAt?: number;
  // approved, denied, cancelled가 된 시각. 퇴근 장면을 보여줄 시간이 지나면 목록에서 정리한다.
  endedAt?: number;
};

export type Session = {
  id: string;
  source?: "codex";
  // 명령 연결만 성공한 상태를 실제 활동 수집 성공과 구분한다.
  codexActivitySource?: "hooks" | "transcript" | "unavailable";
  // hook 관찰은 해당 턴에만 유효하다. 다음 원격 턴의 기록 표시를 막지 않는다.
  codexHookTurnId?: string;
  // 정확히 연결해 반영한 바깥 코드 호출의 거절 기록. 같은 기록을 다른 대기에 재사용하지 않는다.
  codexRejectionIds?: string[];
  turnId?: string;
  name: string;
  // 세션을 연 폴더의 전체 경로. /clear로 같은 곳에서 시작한 새 세션을 알아보는 데만 쓰고, 호스팅으로는 보내지 않는다.
  cwd?: string;
  // 세션을 연 폴더가 속한 저장소의 전체 경로. 워크트리에서 연 세션도 원래 저장소로 묶는 데 쓰고, 호스팅으로는 보내지 않는다.
  projectRoot?: string;
  // 그 저장소의 폴더 이름. 같은 프로젝트의 세션을 한 사무실 탭으로 묶어 보여줄 때 탭 이름이 된다.
  project?: string;
  // 호스팅으로 보낼 때 전체 경로 대신 붙이는 저장소 구분값. 경로를 되돌릴 수 없는 짧은 해시다.
  projectId?: string;
  connected: boolean;
  // /office close로 연결을 끊었다. 다시 /office로 연결하기 전까지 이 세션의 이벤트를 반영하지 않는다.
  closed?: boolean;
  // 연결된 세션의 진행 중 턴·캐릭터가 있으면 켠다. Claude는 연결 직후 대기 장면도 유지한다.
  lit: boolean;
  // 사용자가 요청을 보낸 뒤(UserPromptSubmit) 턴이 끝날 때(Stop)까지. 도구 호출 사이에 생각하는 동안에도 불을 켜 둔다.
  inTurn?: boolean;
  // 본 세션의 진행을 마지막으로 확인한 시각. 이보다 오래된 중단 기록으로 현재 턴을 끝내지 않는다.
  turnActivityAt?: number;
  // 마지막으로 턴이 끝난 시각(Stop, 중단, 세션 종료). 그보다 앞서 시작한 모델 호출 기록으로 턴을 다시 켜지 않는다.
  turnEndedAt?: number;
  doneCount: number;
  // 진행 중이던 턴을 한 번이라도 마쳤다. 도구 없이 답만 한 턴은 doneCount가 늘지 않으므로, 연결만 한 상태와 이것으로 구분한다.
  answered?: boolean;
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

// 소식이 끊긴 PC와 끊긴 시간(초). 호스팅 화면이 만들고, 공통 사무실 화면이 안내로 보여준다.
export type StaleMachine = { machine: string; ageSec: number };

export type OfficeState = {
  sessions: Record<string, Session>;
  order: string[];
  // 같은 폴더의 새 세션 때문에 탭에서 내린 세션. 실제로는 살아 있던 세션이 다시 이벤트를 보내면 그대로 되살린다.
  retired?: Record<string, Session>;
  // 서버가 켜질 때마다 바뀌는 값. 화면은 이 값이 바뀌면 서버가 다시 켜진 것을 안다.
  instance?: string;
};
