import { describe, expect, test } from "vitest";

import { composeHostedState } from "./hosted/compose";
import { redactState } from "./hosted/redact";
import { projectOffices } from "./project-office";
import type { Character, OfficeState, Session } from "./types";

const call = (id: string, status: Character["status"]): Character => ({
  id, kind: "tool", status, label: "Read", toolName: "Read", toolInput: {}, since: 0,
});
const session = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: id, connected: true, lit: false, doneCount: 0, characters: [], ...extra,
});
const stateOf = (...sessions: Session[]): OfficeState => ({
  sessions: Object.fromEntries(sessions.map((s) => [s.id, s])),
  order: sessions.map((s) => s.id),
});
const shown = (s: Session) => s.connected || s.characters.length > 0;

describe("프로젝트 사무실", () => {
  test("같은 저장소 경로의 세션은 하나로 묶고, 이름만 같은 다른 저장소는 따로 둔다", () => {
    const offices = projectOffices(
      stateOf(
        session("a", { projectRoot: "/work/blog", project: "blog" }),
        session("b", { projectRoot: "/work/blog", project: "blog" }),
        session("c", { projectRoot: "/other/blog", project: "blog" }),
        session("plain")
      ),
      shown
    );

    expect(offices.map((o) => [o.key, o.sessionIds])).toEqual([
      ["/work/blog", ["a", "b"]],
      ["/other/blog", ["c"]],
      ["plain", ["plain"]],
    ]);
    expect(offices[0].session.name).toBe("blog");
  });

  test("한 세션이라도 일하면 불을 켜고, 캐릭터에는 세션 번호를 붙인다", () => {
    const [office] = projectOffices(
      stateOf(
        session("a", { project: "blog", characters: [call("t1", "working")], lit: true, inTurn: true }),
        session("b", { project: "blog", source: "codex", characters: [call("t2", "waiting")] })
      ),
      shown
    );

    expect(office.session).toMatchObject({ lit: true, inTurn: true, connected: true });
    expect(office.session.characters.map((c) => [c.id, c.label, c.speaker])).toEqual([
      ["t1", "#1 Claude · Read", "#1 Claude"], ["t2", "#2 ChatGPT · Read", "#2 ChatGPT"],
    ]);
  });

  test("세션이 하나면 캐릭터와 목록에 번호를 붙이지 않는다", () => {
    const [office] = projectOffices(
      stateOf(session("a", { characters: [call("t1", "working")], plan: [{ content: "고치기", status: "pending" }] })),
      shown
    );

    expect(office.session.characters[0].label).toBe("Claude · Read");
    expect(office.plans).toEqual([{ items: [{ content: "고치기", status: "pending" }] }]);
  });

  test("종료된 세션은 묶음에서 빠진다", () => {
    const offices = projectOffices(
      stateOf(session("a", { project: "blog" }), session("b", { project: "blog", connected: false })),
      shown
    );

    expect(offices[0].sessionIds).toEqual(["a"]);
  });
});

describe("호스팅 화면의 프로젝트 사무실", () => {
  test("로컬과 가림 처리·합성 뒤 호스팅에서 같은 제공자 이름을 표시한다", () => {
    const local = stateOf(
      session("a", { projectRoot: "/work/blog", project: "blog", characters: [call("t1", "working")] }),
      session("b", { source: "codex", projectRoot: "/work/blog", project: "blog", characters: [call("t2", "waiting")] }),
    );
    const original = structuredClone(local);
    const hosted = composeHostedState({
      serverNow: 1_000,
      machines: [{ machine: "mac", heartbeatSec: 20, receivedAt: 1_000, state: redactState(local) }],
    }).state;
    const labels = (state: OfficeState) => projectOffices(state, shown)[0].session.characters.map((c) => [c.label, c.speaker]);
    expect(labels(hosted)).toEqual([["#1 Claude · Read", "#1 Claude"], ["#2 ChatGPT · Read", "#2 ChatGPT"]]);
    expect(labels(local)).toEqual(labels(hosted));
    expect(local).toEqual(original);
  });

  test("단일 Codex 세션에도 ChatGPT를 표시한다", () => {
    const [office] = projectOffices(stateOf(session("a", { source: "codex", characters: [call("t1", "working")] })), shown);
    expect(office.session.characters[0]).toMatchObject({ label: "ChatGPT · Read", speaker: "ChatGPT" });
  });

  test("한 PC에서 이름만 같은 다른 저장소는 경로를 지운 뒤에도 따로 보인다", () => {
    const local = stateOf(
      session("a", { projectRoot: "/work/blog", project: "blog" }),
      session("b", { projectRoot: "/work/blog", project: "blog" }),
      session("c", { projectRoot: "/other/blog", project: "blog" })
    );
    const hosted = composeHostedState({
      serverNow: 1_000,
      machines: [{ machine: "mac", heartbeatSec: 20, receivedAt: 1_000, state: redactState(local) }],
    }).state;

    expect(projectOffices(hosted, shown).map((o) => o.sessionIds)).toEqual([["mac::a", "mac::b"], ["mac::c"]]);
  });
});
