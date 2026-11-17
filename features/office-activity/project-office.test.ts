import { describe, expect, test } from "vitest";

import { composeHostedState } from "./hosted/compose";
import { redactState } from "./hosted/redact";
import { projectOffices } from "./project-office";
import { SceneEngine } from "./scene/scene-engine";
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
    expect(office.characters.map((c) => [c.id, c.label, c.speaker])).toEqual([
      ["t1", "Read", "#1 Claude"], ["t2", "Read", "#2 ChatGPT"],
    ]);
    // 합친 세션 상태에는 화면용 표시를 섞지 않는다.
    expect(office.session.characters.map((c) => c.label)).toEqual(["Read", "Read"]);
    expect(office.session.characters[0]).not.toHaveProperty("speaker");
  });

  test("세션이 하나면 캐릭터와 목록에 번호를 붙이지 않는다", () => {
    const [office] = projectOffices(
      stateOf(session("a", { characters: [call("t1", "working")], plan: [{ content: "고치기", status: "pending" }] })),
      shown
    );

    expect(office.characters[0].label).toBe("Read");
    expect(office.characters[0].speaker).toBeUndefined();
    expect(office.plans).toEqual([{ items: [{ content: "고치기", status: "pending" }] }]);
  });

  test("종료된 세션은 묶음에서 빠진다", () => {
    const offices = projectOffices(
      stateOf(session("a", { project: "blog" }), session("b", { project: "blog", connected: false })),
      shown
    );

    expect(offices[0].sessionIds).toEqual(["a"]);
  });

  test("여러 세션에서 하나만 남으면 제공자 이름과 번호를 지운다", () => {
    const a = session("a", { project: "blog", source: "codex", characters: [call("t1", "working")] });
    const b = session("b", { project: "blog", inTurn: true });
    expect(projectOffices(stateOf(a, b), shown)[0].characters[0].speaker).toBe("#1 ChatGPT");
    const remaining = projectOffices(stateOf(a, { ...b, connected: false, inTurn: false }), shown)[0].characters[0];
    expect(remaining.label).toBe("Read");
    expect(remaining.speaker).toBeUndefined();
  });

  test("연결만 해 둔 세션은 세지 않아, 일하는 세션이 하나면 번호와 제공자를 붙이지 않는다", () => {
    const [office] = projectOffices(
      stateOf(session("a", { project: "blog" }), session("b", { project: "blog", source: "codex", characters: [call("t1", "working")] })),
      shown
    );

    expect(office.sessionIds).toEqual(["a", "b"]);
    expect(office.characters[0].speaker).toBeUndefined();
  });

  test("세션이 끝나도 남은 세션의 번호는 당겨지지 않는다", () => {
    const office = (first: Session) => projectOffices(stateOf(
      first,
      session("b", { project: "blog", characters: [call("t2", "working")] }),
      session("c", { project: "blog", source: "codex", characters: [call("t3", "working")] }),
    ), shown)[0];

    const a = session("a", { project: "blog", inTurn: true, characters: [call("t1", "working")] });
    expect(office(a).characters.map((c) => c.speaker)).toEqual(["#1 Claude", "#2 Claude", "#3 ChatGPT"]);
    // 끝난 세션의 캐릭터가 문밖으로 나가는 동안 남은 세션이 같은 번호를 받지 않는다.
    const ended = office({ ...a, connected: false, inTurn: false, characters: [] });
    expect(ended.sessionIds).toEqual(["b", "c"]);
    expect(ended.characters.map((c) => c.speaker)).toEqual(["#2 Claude", "#3 ChatGPT"]);
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
    const labels = (state: OfficeState) => projectOffices(state, shown)[0].characters.map((c) => [c.label, c.speaker]);
    expect(labels(hosted)).toEqual([["Read", "#1 Claude"], ["Read", "#2 ChatGPT"]]);
    expect(labels(local)).toEqual(labels(hosted));
    expect(local).toEqual(original);
  });

  test("끝난 세션을 보내지 않아도 호스팅의 세션 번호가 로컬과 같다", () => {
    const local = stateOf(
      session("a", { project: "blog", connected: false }),
      session("b", { project: "blog", characters: [call("t2", "working")] }),
      session("c", { project: "blog", source: "codex", characters: [call("t3", "working")] }),
    );
    const hosted = composeHostedState({
      serverNow: 1_000,
      machines: [{ machine: "mac", heartbeatSec: 20, receivedAt: 1_000, state: redactState(local) }],
    }).state;
    const speakers = (state: OfficeState) => projectOffices(state, shown)[0].characters.map((c) => c.speaker);

    expect(hosted.order).toEqual(["mac::b", "mac::c"]);
    expect(speakers(local)).toEqual(["#2 Claude", "#3 ChatGPT"]);
    expect(speakers(hosted)).toEqual(speakers(local));
  });

  test("호스팅의 단일 Codex 세션은 도구 이름만 표시한다", () => {
    const hosted = composeHostedState({
      serverNow: 1_000,
      machines: [{ machine: "mac", heartbeatSec: 20, receivedAt: 1_000,
        state: redactState(stateOf(session("a", { source: "codex", characters: [call("t1", "working")] }))) }],
    }).state;
    const [office] = projectOffices(hosted, shown);
    expect(office.characters[0].label).toBe("Read");
    expect(office.characters[0].speaker).toBeUndefined();
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

test("세션별 같은 ID와 복구한 ID를 화면에서 독립된 캐릭터로 유지한다", () => {
  const a = session("a", { project: "blog", characters: [call("permission-2000-0", "waiting")] });
  const b = session("b", { project: "blog", characters: [call("permission-2000-0", "waiting")] });
  const engine = new SceneEngine(() => 0.5);
  const sync = (state: OfficeState) => engine.sync(projectOffices(state, shown)[0].characters, true);
  sync(stateOf(a, b));
  expect(engine.walkers).toHaveLength(2);
  expect(new Set(engine.walkers.map((w) => w.id)).size).toBe(2);
  const original = engine.walkers[0];
  sync(stateOf({ ...a, characters: [{ ...a.characters[0], id: "real-id", sceneId: "permission-2000-0", status: "approved" }] }, b));
  expect(engine.walkers).toHaveLength(2);
  expect(engine.walkers[0]).toBe(original);
  expect(engine.walkers[0].bubble).toBe("glad");
  expect(engine.walkers[1].bubble).toBe("ask");
});
