import { describe, expect, test } from "vitest";
import { ingestHookEvent, officeSnapshot } from "./server";

// 대화가 요약되면 /office 스킬의 hook이 사라진다. 같은 hook을 프로젝트 설정에도 두고(?via=settings),
// 설정 hook은 연결한 세션의 것만 받으며, 두 경로로 똑같이 온 신호는 한 번만 반영한다.
function harness() {
  const id = crypto.randomUUID();
  let now = Date.now();
  const event = (name: string, extra: Record<string, unknown> = {}) => ({ session_id: id, hook_event_name: name, ...extra });
  return {
    id,
    skill: (name: string, extra?: Record<string, unknown>) => ingestHookEvent(event(name, extra), ++now, "skill"),
    settings: (name: string, extra?: Record<string, unknown>) => ingestHookEvent(event(name, extra), ++now, "settings"),
    both: (name: string, extra?: Record<string, unknown>) => {
      const payload = event(name, extra);
      ingestHookEvent(payload, ++now, "skill");
      ingestHookEvent({ ...payload }, ++now, "settings");
    },
    session: () => officeSnapshot(now).sessions[id],
  };
}

const read = { tool_use_id: "t1", tool_name: "Read", tool_input: { file_path: "/tmp/a.ts" } };

describe("hook 경로", () => {
  test("연결하지 않은 세션의 설정 hook으로는 세션을 만들지 않는다", () => {
    const h = harness();
    for (const name of ["UserPromptSubmit", "PreToolUse", "Stop", "Notification", "SubagentStart"]) h.settings(name, read);
    expect(h.session()).toBeUndefined();
  });

  test("스킬 hook이 사라진 뒤에도 설정 hook으로 턴과 도구를 보여 준다", () => {
    const h = harness();
    h.skill("OfficeConnect");
    h.settings("UserPromptSubmit");
    h.settings("PreToolUse", read);
    expect(h.session()).toMatchObject({ inTurn: true, lit: true, characters: [{ id: "t1", status: "working" }] });
    h.skill("PostToolUse", read);
    h.settings("Stop");
    expect(h.session()).toMatchObject({ inTurn: false, lit: false, doneCount: 1, answered: true });
  });

  test("스킬과 설정 hook이 함께 살아 있으면 같은 신호를 한 번만 반영한다", () => {
    const h = harness();
    h.skill("OfficeConnect");
    h.both("UserPromptSubmit", { prompt: "hi" });
    h.both("PreToolUse", read);
    h.both("PreToolUse", { ...read, tool_use_id: "t2" });
    expect(h.session().characters.map((c) => c.id)).toEqual(["t1", "t2"]);
    h.skill("PostToolUse", read);
    h.skill("PostToolUse", { ...read, tool_use_id: "t2" });
    h.both("Stop");
    expect(h.session()).toMatchObject({ doneCount: 2, inTurn: false, lit: false });
  });

  test("서버가 연결 신호를 놓친 세션도 스킬 hook으로는 이전 상태를 모르는 세션으로 나타난다", () => {
    const h = harness();
    h.skill("PreToolUse", read);
    expect(h.session()).toMatchObject({ priorUnknown: true, lit: true });
  });

  test("모르는 세션의 종료 신호로 탭을 만들지 않는다", () => {
    const h = harness();
    h.skill("SessionEnd");
    expect(h.session()).toBeUndefined();
  });
});
