import { afterEach, describe, expect, test, vi } from "vitest";

import { listRawEvents } from "./raw-event-log";
import { ingestHookEvent, officeSnapshot } from "./server";

// 파일 감시의 타이밍과 분리해, 읽은 줄이 서버를 거쳐 상태 판정에 전달되는 흐름을 검증한다.
const readers = vi.hoisted(() => new Map<string, (lines: string) => void>());
vi.mock("./transcript-watch", async (importOriginal) => ({
  ...await importOriginal<typeof import("./transcript-watch")>(),
  followTranscript: (id: string, _path: string, read: (lines: string) => void) => {
    if (!readers.has(id)) readers.set(id, read);
  },
  stopFollowing: (id: string) => readers.delete(id),
}));

function harness() {
  const id = crypto.randomUUID();
  const send = (name: string, now: number, extra: Record<string, unknown> = {}) =>
    ingestHookEvent({ hook_event_name: name, session_id: id, ...extra }, now);
  send("OfficeConnect", 1_000, { transcript_path: `/transcripts/${id}.jsonl` });

  return {
    send,
    session: () => officeSnapshot().sessions[id],
    append: (...entries: unknown[]) => readers.get(id)!(entries.map((entry) => JSON.stringify(entry)).join("\n")),
    interruption: () => listRawEvents().findLast(
      ({ payload }) => payload.session_id === id && payload.hook_event_name === "TranscriptInterrupted"
    )?.payload,
  };
}

const interrupt = (at: number, tool = false) => ({
  type: "user", timestamp: new Date(at).toISOString(),
  message: { content: [{ type: "text", text: tool ? "[Request interrupted by user for tool use]" : "[Request interrupted by user]" }] },
});
const result = (id: string) => ({
  type: "user", toolUseResult: "User rejected tool use",
  message: { content: [{ type: "tool_result", tool_use_id: id, content: "The user doesn't want to proceed with this tool use." }] },
});
const request = (at: number) => ({ type: "api-request", querySource: "repl_main_thread", timestamp: new Date(at).toISOString() });
const call = { tool_use_id: "new-call", tool_name: "Read", tool_input: { file_path: "PRODUCT.md" } };

afterEach(() => {
  for (const id of [...readers.keys()]) {
    ingestHookEvent({ hook_event_name: "SessionEnd", session_id: id });
  }
});

describe("transcript의 중단 시각을 상태 판정까지 전달하기", () => {
  test("이전 중단과 새 모델 호출을 같이 읽어도 새 턴의 허용 대기는 남는다", () => {
    const h = harness();
    h.send("UserPromptSubmit", 2_000);
    h.send("PreToolUse", 2_100, call);
    h.send("PermissionRequest", 2_200, call);
    h.append(interrupt(1_500), request(2_300));

    expect(h.interruption()).toMatchObject({ interrupted_at: 1_500 });
    expect(h.session()).toMatchObject({ inTurn: true, lit: true, doneCount: 0 });
    expect(h.session().characters).toEqual([expect.objectContaining({ id: "new-call", status: "waiting" })]);
  });

  test("현재 중단은 정리하고, 뒤늦게 읽은 다음 모델 호출로 새 턴을 시작할 수 있다", () => {
    const h = harness();
    h.send("PreToolUse", 2_000, call);
    h.append(interrupt(2_100));

    expect(h.interruption()).toMatchObject({ interrupted_at: 2_100 });
    expect(h.session()).toMatchObject({ inTurn: false, lit: false, characters: [], turnEndedAt: 2_100 });

    h.append(request(3_000));
    expect(h.session().inTurn).toBe(true);
    expect(h.session().lit).toBe(true);
  });

  test.each([false, true])("새 턴 중 기록된 옛 호출의 중단은 새 호출을 끝내지 않는다(새 허용 대기: %s)", (waiting) => {
    const h = harness();
    h.send("PreToolUse", 1_100, { ...call, tool_use_id: "old-call" });
    h.send("PermissionRequest", 1_200, call);
    h.send("Stop", 2_000);
    h.send("UserPromptSubmit", 12_000);
    h.send("PreToolUse", 12_100, call);
    if (waiting) h.send("PermissionRequest", 12_200, call);
    h.append(result("old-call"), interrupt(13_000, true));

    expect(h.session()).toMatchObject({ inTurn: true, lit: true, doneCount: 1 });
    expect(h.session().characters).toEqual([
      expect.objectContaining({ id: "new-call", status: waiting ? "waiting" : "working" }),
    ]);
  });

  test("현재 호출의 거절과 도구 중단은 턴을 끝내면서 거절됨 표시를 보존한다", () => {
    const h = harness();
    h.send("PreToolUse", 2_000, call);
    h.send("PermissionRequest", 2_100, call);
    h.append(result("new-call"), interrupt(2_200, true));

    expect(h.interruption()).toMatchObject({ tool_use_id: "new-call", interruption_kind: "tool" });
    expect(h.session()).toMatchObject({ inTurn: false, lit: false, doneCount: 1, turnEndedAt: 2_200 });
    expect(h.session().characters).toEqual([expect.objectContaining({ id: "new-call", status: "denied" })]);
  });

  test("같은 줄의 거절과 도구 중단은 앞선 결과 대신 현재 호출을 끝낸다", () => {
    const h = harness();
    h.send("PreToolUse", 2_000, call);
    h.send("PermissionRequest", 2_100, call);
    h.append(result("old-call"), {
      ...result("new-call"), timestamp: new Date(2_200).toISOString(),
      message: { content: [...result("new-call").message.content, ...interrupt(2_200, true).message.content] },
    });

    expect(h.interruption()).toMatchObject({ tool_use_id: "new-call" });
    expect(h.session()).toMatchObject({ inTurn: false, lit: false, doneCount: 1, turnEndedAt: 2_200 });
    expect(h.session().characters).toEqual([expect.objectContaining({ id: "new-call", status: "denied" })]);
  });

  test("이전 결과와 중단 사이에 다른 줄이 끼어도 새 허용 대기를 끝내지 않는다", () => {
    const h = harness();
    h.send("PreToolUse", 1_100, { ...call, tool_use_id: "old-call" });
    h.send("Stop", 2_000);
    h.send("UserPromptSubmit", 12_000);
    h.send("PreToolUse", 12_100, call);
    h.send("PermissionRequest", 12_200, call);
    h.append(result("old-call"), { type: "system", subtype: "format-change-marker" }, interrupt(13_000, true));

    expect(h.interruption()?.tool_use_id).toBeUndefined();
    expect(h.session()).toMatchObject({ inTurn: true, lit: true, doneCount: 1 });
    expect(h.session().characters).toEqual([expect.objectContaining({ id: "new-call", status: "waiting" })]);
  });

  test("거절 결과와 도구 중단을 나눠 읽어도 대상 호출을 이어 붙인다", () => {
    const h = harness();
    h.send("PreToolUse", 2_000, call);
    h.send("PermissionRequest", 2_100, call);
    h.append(result("new-call"));
    expect(h.session().inTurn).toBe(true);
    h.append(interrupt(2_200, true));

    expect(h.interruption()).toMatchObject({ tool_use_id: "new-call" });
    expect(h.session()).toMatchObject({ inTurn: false, doneCount: 1 });
    expect(h.session().characters[0]).toMatchObject({ status: "denied" });
  });

  test("PreToolUse를 놓친 허용 대기도 transcript의 같은 도구와 입력으로만 중단한다", () => {
    const h = harness();
    h.send("UserPromptSubmit", 2_000);
    h.send("PermissionRequest", 2_100, call);
    h.append({
      type: "assistant", timestamp: new Date(2_050).toISOString(),
      message: { content: [{ type: "tool_use", id: "new-call", name: call.tool_name, input: call.tool_input }] },
    }, result("new-call"), interrupt(2_200, true));

    expect(h.session()).toMatchObject({ inTurn: false, doneCount: 1 });
    expect(h.session().characters).toEqual([expect.objectContaining({ id: "new-call", status: "denied" })]);
  });

  test("현재 허용 대기가 있어도 대상 id 없는 도구 중단으로 턴을 끝내지 않는다", () => {
    const h = harness();
    h.send("PreToolUse", 2_000, call);
    h.send("PermissionRequest", 2_100, call);
    h.append(interrupt(2_200, true));

    expect(h.session()).toMatchObject({ inTurn: true, lit: true, doneCount: 0 });
    expect(h.session().characters[0]).toMatchObject({ id: "new-call", status: "waiting" });
  });

  test("sub-agent 호출의 도구 중단으로 본 세션의 호출을 끝내지 않는다", () => {
    const h = harness();
    h.send("PreToolUse", 2_000, call);
    h.send("PreToolUse", 2_100, { ...call, agent_id: "child", tool_use_id: "child-call" });
    h.append(result("child-call"), interrupt(2_200, true));

    expect(h.session()).toMatchObject({ inTurn: true, lit: true });
    expect(h.session().characters.find((c) => c.id === "new-call")).toMatchObject({ status: "working" });
  });

  test("지난 턴의 같은 입력 결과를 새 id 없는 허용 대기에 붙이지 않는다", () => {
    const h = harness();
    h.send("PreToolUse", 1_100, { ...call, tool_use_id: "old-call" });
    h.append({
      type: "assistant", timestamp: new Date(1_050).toISOString(),
      message: { content: [{ type: "tool_use", id: "old-call", name: call.tool_name, input: call.tool_input }] },
    });
    h.send("Stop", 2_000);
    h.send("UserPromptSubmit", 12_000);
    h.send("PermissionRequest", 12_100, call);
    h.append(result("old-call"), interrupt(13_000, true));

    expect(h.session()).toMatchObject({ inTurn: true, lit: true, doneCount: 1 });
    expect(h.session().characters).toEqual([expect.objectContaining({ orphan: true, status: "waiting" })]);
  });

  test("시각 없는 중단은 턴을 끝내지 않지만 원본 이벤트에 관측 흔적을 남긴다", () => {
    const h = harness();
    h.send("PreToolUse", 2_000, call);
    h.append({ type: "user", message: { content: "[Request interrupted by user]" } });

    expect(h.interruption()).toMatchObject({ interruption_kind: "turn" });
    expect(h.interruption()?.interrupted_at).toBeUndefined();
    expect(h.session()).toMatchObject({ inTurn: true, characters: [expect.objectContaining({ id: "new-call" })] });
  });
});
