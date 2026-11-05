import type { OfficeState, PlanItem, Session } from "./types";

// 같은 저장소(워크트리 포함)에서 연 세션들을 사무실 하나로 묶는다.
// 세션 상태는 세션마다 그대로 두고, 화면에 보여줄 때만 한 세션처럼 합친다.

// 게시판에 적는 task 목록 하나. 세션이 여럿이면 어느 세션의 목록인지 제목을 단다.
export type BoardPlan = { title?: string; items: PlanItem[] };

export type ProjectOffice = {
  key: string;
  sessionIds: string[];
  // 묶인 세션을 합친 모습. 탭, 배지, 장면이 한 세션처럼 읽는다.
  session: Session;
  plans: BoardPlan[];
};

export function projectOffices(state: OfficeState, shown: (session: Session) => boolean): ProjectOffice[] {
  const groups = new Map<string, Session[]>();
  for (const id of state.order) {
    const session = state.sessions[id];
    if (!session || !shown(session)) continue;
    const key = projectKey(session);
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  return [...groups].map(([key, members]) => ({
    key,
    sessionIds: members.map((s) => s.id),
    session: merge(key, members),
    plans: boardPlans(members),
  }));
}

// 로컬은 저장소 경로, 호스팅은 경로 대신 받은 구분값으로 묶는다. 둘 다 없으면(git 저장소가 아님)
// 저장소 이름, 그마저 없으면 폴더 이름으로 묶는다.
function projectKey(session: Session): string {
  return session.projectRoot ?? session.projectId ?? session.project ?? session.name;
}

// 세션이 여럿이면 캐릭터 말풍선과 게시판 제목에 같은 번호를 붙여 어느 세션의 일인지 알아보게 한다.
const mark = (members: Session[], i: number) => (members.length > 1 ? `#${i + 1} ` : "");

function merge(key: string, members: Session[]): Session {
  const [first] = members;
  return {
    id: key,
    name: first.project ?? first.name,
    connected: members.some((s) => s.connected),
    lit: members.some((s) => s.lit),
    inTurn: members.some((s) => s.inTurn === true),
    doneCount: members.reduce((sum, s) => sum + s.doneCount, 0),
    answered: members.some((s) => s.answered === true),
    priorUnknown: members.some((s) => s.connected && s.priorUnknown === true),
    transcriptUnreliable: members.some((s) => s.transcriptUnreliable === true),
    characters: members.flatMap((s, i) =>
      s.characters.map((c) => (members.length > 1 ? { ...c, label: `${mark(members, i)}${c.label}` } : c))
    ),
  };
}

// 아직 끝나지 않은 목록을 먼저 적는다.
function boardPlans(members: Session[]): BoardPlan[] {
  const plans = members.flatMap((s, i) =>
    s.plan?.length ? [{ ...(members.length > 1 ? { title: `${mark(members, i)}${s.name}` } : {}), items: s.plan }] : []
  );
  const open = (plan: BoardPlan) => plan.items.some((item) => item.status !== "completed");
  return [...plans.filter(open), ...plans.filter((plan) => !open(plan))];
}
