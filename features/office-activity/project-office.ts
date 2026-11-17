import type { Character, OfficeState, PlanItem, Session } from "./types";

// 같은 저장소(워크트리 포함)에서 연 세션들을 사무실 하나로 묶는다.
// 세션 상태는 세션마다 그대로 두고, 화면에 보여줄 때만 한 세션처럼 합친다.

// 게시판에 적는 task 목록 하나. 세션이 여럿이면 어느 세션의 목록인지 제목을 단다.
export type BoardPlan = { title?: string; items: PlanItem[] };

// 장면에 보낼 캐릭터. 세션이 여럿 일하면 말풍선에 붙일 세션 번호와 제공자 이름(speaker)을 함께 싣는다.
export type OfficeCharacter = Character & { speaker?: string };

export type ProjectOffice = {
  key: string;
  sessionIds: string[];
  // 묶인 세션을 합친 모습. 탭, 배지, 장면이 한 세션처럼 읽는다.
  session: Session;
  plans: BoardPlan[];
  characters: OfficeCharacter[];
};

export function projectOffices(state: OfficeState, shown: (session: Session) => boolean): ProjectOffice[] {
  const numbers = sessionNumbers(state);
  return [...projectGroups(state)].flatMap(([key, all]) => {
    const members = all.filter(shown);
    if (!members.length) return [];
    const mark = (s: Session) => `#${numbers[s.id]}`;
    const labeled = members.filter(isBusy).length > 1;
    return [{
      key,
      sessionIds: members.map((s) => s.id),
      session: merge(key, members),
      plans: boardPlans(members, mark),
      characters: members.flatMap((s) => s.characters.map((c) => ({
        ...c,
        // 세션 안의 호출 ID가 다른 세션과 같아도 장면에서는 서로 다른 직원이다.
        sceneId: JSON.stringify([s.id, c.sceneId ?? c.id]),
        ...(labeled ? { speaker: `${mark(s)} ${s.source === "codex" ? "ChatGPT" : "Claude"}` } : {}),
      }))),
    }];
  });
}

// 같은 프로젝트 안에서 세션 번호. 끝난 세션도 세어, 앞선 세션이 끝나도 남은 세션의 번호가 당겨지지 않는다.
// 호스팅으로는 끝난 세션을 보내지 않으므로, 로컬에서 정한 번호(number)를 함께 보내 그것을 쓴다.
export function sessionNumbers(state: OfficeState): Record<string, number> {
  const numbers: Record<string, number> = {};
  for (const all of projectGroups(state).values()) {
    all.forEach((s, i) => (numbers[s.id] = s.number ?? i + 1));
  }
  return numbers;
}

function projectGroups(state: OfficeState): Map<string, Session[]> {
  const groups = new Map<string, Session[]>();
  for (const id of state.order) {
    const session = state.sessions[id];
    if (!session) continue;
    const key = projectKey(session);
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  return groups;
}

// 로컬은 저장소 경로, 호스팅은 경로 대신 받은 구분값으로 묶는다. 둘 다 없으면(git 저장소가 아님)
// 저장소 이름, 그마저 없으면 폴더 이름으로 묶는다.
function projectKey(session: Session): string {
  return session.projectRoot ?? session.projectId ?? session.project ?? session.name;
}

// 캐릭터 말풍선의 세션 번호와 제공자는 둘 이상의 세션이 함께 일할 때만 붙인다. 연결만 해 둔 세션은 세지 않는다.
function isBusy(session: Session): boolean {
  return session.inTurn === true || session.characters.length > 0;
}

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
    codexActivitySource: members.some((s) => s.connected && s.codexActivitySource === "unavailable") ? "unavailable"
      : members.some((s) => s.connected && s.codexActivitySource === "transcript") ? "transcript" : undefined,
    characters: members.flatMap((s) => s.characters),
  };
}

// 세션이 여럿이면 게시판 제목에도 말풍선과 같은 번호를 붙인다. 아직 끝나지 않은 목록을 먼저 적는다.
function boardPlans(members: Session[], mark: (s: Session) => string): BoardPlan[] {
  const plans = members.flatMap((s) =>
    s.plan?.length ? [{ ...(members.length > 1 ? { title: `${mark(s)} ${s.name}` } : {}), items: s.plan }] : []
  );
  const open = (plan: BoardPlan) => plan.items.some((item) => item.status !== "completed");
  return [...plans.filter(open), ...plans.filter((plan) => !open(plan))];
}
