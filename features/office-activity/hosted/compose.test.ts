import { describe, expect, test } from "vitest";

import type { OfficeState } from "../types";
import { composeHostedState, nextPollDelayMs } from "./compose";
import type { HostedMachine } from "./types";

const NOW = 1_000_000;

function machineState(name: string, characters = 0, extra: Partial<OfficeState> = {}): OfficeState {
  return {
    sessions: {
      s1: {
        id: "s1",
        name,
        connected: true,
        lit: true,
        doneCount: 0,
        characters: Array.from({ length: characters }, (_, i) => ({
          id: `c${i}`, kind: "tool" as const, status: "working" as const, label: "Read", toolName: "Read", toolInput: null, since: 1,
        })),
      },
    },
    order: ["s1"],
    ...extra,
  };
}

function machine(name: string, receivedAgoSec: number, state: OfficeState, heartbeatSec = 20): HostedMachine {
  return { machine: name, heartbeatSec, receivedAt: NOW - receivedAgoSec * 1000, state };
}

describe("PC들의 상태를 한 화면으로 합치기", () => {
  test("PC가 하나면 세션 이름을 그대로 쓴다", () => {
    const { state } = composeHostedState({ serverNow: NOW, machines: [machine("work-pc", 5, machineState("side-project"))] });

    expect(state.order).toHaveLength(1);
    expect(state.sessions[state.order[0]].name).toBe("side-project");
  });

  test("PC가 둘 이상이면 세션 이름에 PC 이름을 붙이고, 같은 세션 번호도 따로 둔다", () => {
    const { state } = composeHostedState({
      serverNow: NOW,
      machines: [machine("laptop", 5, machineState("blog")), machine("work-pc", 5, machineState("side-project", 2))],
    });

    expect(state.order).toHaveLength(2);
    expect(state.order.map((id) => state.sessions[id].name)).toEqual(["blog · laptop", "side-project · work-pc"]);
    expect(state.sessions[state.order[1]].characters).toHaveLength(2);
  });

  test("연결된 PC가 없으면 빈 상태다", () => {
    const { state, stale } = composeHostedState({ serverNow: NOW, machines: [] });

    expect(state.order).toEqual([]);
    expect(stale).toEqual([]);
  });

  test("PC의 서버 시작 값을 PC별로 모아 둔다", () => {
    const { instances } = composeHostedState({
      serverNow: NOW,
      machines: [machine("work-pc", 5, machineState("a", 0, { instance: "boot-1" }))],
    });

    expect(instances).toEqual({ "work-pc": "boot-1" });
  });
});

describe("소식이 끊긴 PC", () => {
  test("살아 있음 신호 간격의 세 배가 지나면 끊긴 것으로 본다", () => {
    const fresh = composeHostedState({ serverNow: NOW, machines: [machine("work-pc", 59, machineState("a"))] });
    const lost = composeHostedState({ serverNow: NOW, machines: [machine("work-pc", 61, machineState("a"))] });

    expect(fresh.stale).toEqual([]);
    expect(lost.stale).toEqual([{ machine: "work-pc", ageSec: 61 }]);
  });

  test("간격이 긴 PC는 그에 맞춰 더 기다린다", () => {
    const result = composeHostedState({ serverNow: NOW, machines: [machine("idle-pc", 120, machineState("a"), 60)] });

    expect(result.stale).toEqual([]);
  });

  test("끊긴 PC의 세션은 어느 것인지 알려 주고, 마지막 상태는 그대로 둔다", () => {
    const { state, staleSessions } = composeHostedState({
      serverNow: NOW,
      machines: [machine("work-pc", 300, machineState("side-project", 1)), machine("laptop", 5, machineState("blog"))],
    });

    const lostId = state.order.find((id) => state.sessions[id].name.startsWith("side-project"))!;
    const liveId = state.order.find((id) => state.sessions[id].name.startsWith("blog"))!;
    expect(staleSessions[lostId]).toBe(300);
    expect(staleSessions[liveId]).toBeUndefined();
    expect(state.sessions[lostId].characters).toHaveLength(1);
  });
});

describe("다음 조회까지의 시간", () => {
  test("일하는 캐릭터나 허용 대기가 있으면 4초마다 가져온다", () => {
    expect(nextPollDelayMs({ busy: true, hidden: false })).toBe(4_000);
  });

  test("할 일이 없으면 15초마다 가져온다", () => {
    expect(nextPollDelayMs({ busy: false, hidden: false })).toBe(15_000);
  });

  test("탭이 숨겨지면 가져오지 않는다", () => {
    expect(nextPollDelayMs({ busy: true, hidden: true })).toBeNull();
  });
});
