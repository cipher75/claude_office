import type { OfficeState, Session } from "../types";
import type { HostedSnapshot } from "./types";

// 호스팅이 들고 있는 PC별 상태를 기존 사무실 화면이 읽는 모양(OfficeState 하나)으로 합친다.

export type StaleMachine = { machine: string; ageSec: number };

export type ComposedHosted = {
  state: OfficeState;
  // 소식이 끊긴 PC와 끊긴 시간(초)
  stale: StaleMachine[];
  // 끊긴 PC에 속한 세션 id -> 끊긴 시간(초)
  staleSessions: Record<string, number>;
  // PC마다 로컬 서버가 켜질 때 정한 값. 바뀌면 그 PC의 서버가 다시 켜진 것이다.
  instances: Record<string, string>;
};

// 살아 있음 신호 간격의 몇 배를 넘으면 소식이 끊긴 것으로 보는지
const STALE_AFTER_HEARTBEATS = 3;

export function composeHostedState(snapshot: HostedSnapshot): ComposedHosted {
  const sessions: Record<string, Session> = {};
  const order: string[] = [];
  const stale: StaleMachine[] = [];
  const staleSessions: Record<string, number> = {};
  const instances: Record<string, string> = {};
  const several = snapshot.machines.length > 1;

  for (const machine of snapshot.machines) {
    const ageSec = Math.floor((snapshot.serverNow - machine.receivedAt) / 1000);
    const lost = ageSec > machine.heartbeatSec * STALE_AFTER_HEARTBEATS;
    if (lost) stale.push({ machine: machine.machine, ageSec });
    if (machine.state.instance) instances[machine.machine] = machine.state.instance;

    for (const sessionId of machine.state.order) {
      const session = machine.state.sessions[sessionId];
      if (!session) continue;
      // 서로 다른 PC가 같은 세션 번호를 쓸 수 없도록 PC 이름을 앞에 붙인다.
      const id = `${machine.machine}::${sessionId}`;
      const suffix = several ? ` · ${machine.machine}` : "";
      sessions[id] = {
        ...session,
        id,
        name: `${session.name}${suffix}`,
        // 다른 PC의 같은 이름 저장소는 다른 사무실로 보여준다.
        ...(session.project ? { project: `${session.project}${suffix}` } : {}),
        ...(session.projectId ? { projectId: `${machine.machine}::${session.projectId}` } : {}),
      };
      order.push(id);
      if (lost) staleSessions[id] = ageSec;
    }
  }

  return { state: { sessions, order }, stale, staleSessions, instances };
}

// 1분 미만은 초, 1시간 미만은 분, 그 뒤는 시간으로 쓴다.
export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}초`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분`;
  return `${Math.floor(seconds / 3600)}시간`;
}

export function isBusy(state: OfficeState): boolean {
  return Object.values(state.sessions).some((session) => session.characters.length > 0);
}

// 일이 있으면 자주, 없으면 드물게 가져온다. 탭이 숨겨지면 가져오지 않는다. (호스팅 사용 한도를 아끼기 위해서)
export function nextPollDelayMs({ busy, hidden }: { busy: boolean; hidden: boolean }): number | null {
  if (hidden) return null;
  return busy ? 4_000 : 15_000;
}
