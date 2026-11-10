import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { ingestHookEvent, officeSnapshot } from "./server";

const follow = vi.hoisted(() => vi.fn());
vi.mock("./transcript-watch", async (original) => ({
  ...await original<typeof import("./transcript-watch")>(),
  followTranscript: follow,
}));

function harness() {
  const id = crypto.randomUUID();
  let now = Date.now();
  return {
    id,
    time: () => now,
    advance: (ms: number) => { now += ms; },
    send: (name: string, extra: Record<string, unknown> = {}) => ingestHookEvent({
      source: "codex", session_id: id, hook_event_name: name, ...extra,
    }, ++now),
    session: () => officeSnapshot(now).sessions[`codex:${id}`],
  };
}

const call = { turn_id: "turn-1", tool_use_id: "call-1", tool_name: "Bash", tool_input: { command: "pwd" } };

describe("Codex hook 수집", () => {
  test("연결 전 hook으로 세션을 자동 생성하지 않는다", () => {
    const h = harness();
    for (const name of ["UserPromptSubmit", "PreToolUse", "PermissionRequest", "Stop", "SessionEnd"]) h.send(name, call);
    expect(h.session()).toBeUndefined();
  });

  test("Codex transcript를 Claude 해석기에 넘기지 않는다", () => {
    const h = harness();
    follow.mockClear();
    h.send("OfficeConnect", { transcript_path: "/tmp/codex-rollout.jsonl" });
    h.send("PreToolUse", { ...call, transcript_path: "/tmp/codex-rollout.jsonl" });
    expect(follow).toHaveBeenCalledWith(`codex:${h.id}`, "/tmp/codex-rollout.jsonl", expect.any(Function));
    const callback = follow.mock.calls.at(-1)![2];
    callback(JSON.stringify({ type: "user", timestamp: new Date().toISOString(), message: { content: "[Request interrupted by user]" } }));
    expect(h.session()).toMatchObject({ source: "codex", turnId: "turn-1", inTurn: true });
  });

  test("id 없는 허용 요청을 기존 호출과 연결하고 실행 결과로 정리한다", () => {
    const h = harness();
    h.send("OfficeConnect");
    h.send("PreToolUse", call);
    const request = { turn_id: call.turn_id, tool_name: call.tool_name, tool_input: call.tool_input };
    h.send("PermissionRequest", request);
    expect(h.session().characters).toMatchObject([{ id: "call-1", status: "waiting" }]);
    h.send("PostToolUse", { ...call, tool_response: "done" });
    expect(h.session().characters).toMatchObject([{ status: "approved" }]);
    h.send("Stop", { turn_id: "turn-1" });
    expect(h.session()).toMatchObject({ inTurn: false, lit: false });
  });

  test("도구 없는 답변과 Esc 중단도 턴을 종료한다", () => {
    const h = harness();
    h.send("OfficeConnect");
    h.send("UserPromptSubmit", { turn_id: "text-turn" });
    h.send("Stop", { turn_id: "text-turn" });
    expect(h.session()).toMatchObject({ inTurn: false, lit: false, answered: true });
    h.send("UserPromptSubmit", { turn_id: "turn-1" });
    h.send("PreToolUse", call);
    h.send("PermissionRequest", call);
    h.send("Interrupt", { turn_id: "turn-1" });
    expect(h.session()).toMatchObject({ inTurn: false, lit: false, characters: [{ status: "cancelled" }] });
  });

  test("지난 턴의 늦은 중단으로 현재 호출을 지우지 않는다", () => {
    const h = harness();
    h.send("OfficeConnect");
    h.send("UserPromptSubmit", { turn_id: "old" });
    h.send("Stop", { turn_id: "old" });
    h.send("UserPromptSubmit", { turn_id: "turn-1" });
    h.send("PreToolUse", call);
    h.send("Interrupt", { turn_id: "old" });
    expect(h.session()).toMatchObject({ inTurn: true, characters: [{ id: "call-1", status: "working" }] });
  });

  test("명시적 연결 해제 후 hook을 무시하고 다시 연결할 수 있다", () => {
    const h = harness();
    h.send("OfficeConnect");
    h.send("OfficeDisconnect");
    h.send("PreToolUse", call);
    expect(h.session()).toMatchObject({ connected: false, closed: true, characters: [] });
    h.send("OfficeConnect");
    h.send("PreToolUse", call);
    expect(h.session()).toMatchObject({ connected: true, characters: [{ id: "call-1" }] });
  });

  test("같은 원본 id와 폴더의 Claude 세션도 함께 표시한다", () => {
    const h = harness();
    ingestHookEvent({ session_id: h.id, hook_event_name: "OfficeConnect", cwd: "/tmp/office-codex-project" });
    h.send("OfficeConnect", { cwd: "/tmp/office-codex-project" });
    const state = officeSnapshot();
    expect(state.sessions[h.id]).toBeDefined();
    expect(state.sessions[`codex:${h.id}`]).toBeDefined();
  });

  test("자동 검토가 맡은 허용 요청은 허용 대기로 보이지 않는다", () => {
    const h = harness();
    const transcript_path = rollout("auto_review");
    h.send("OfficeConnect");
    h.send("PreToolUse", { ...call, transcript_path });
    h.send("PermissionRequest", { turn_id: call.turn_id, tool_name: "Bash", tool_input: call.tool_input, transcript_path });
    expect(h.session().characters).toMatchObject([{ id: "call-1", status: "working" }]);
  });

  test("사람이 검토하는 세션의 허용 요청은 허용 대기로 보인다", () => {
    const h = harness();
    const transcript_path = rollout("user");
    h.send("OfficeConnect");
    h.send("PreToolUse", { ...call, transcript_path });
    h.send("PermissionRequest", { turn_id: call.turn_id, tool_name: "Bash", tool_input: call.tool_input, transcript_path });
    expect(h.session().characters).toMatchObject([{ id: "call-1", status: "waiting" }]);
  });

  test("transcript에 거절로 남은 호출은 다음 hook에서 거절로 정리한다", () => {
    const h = harness();
    const transcript_path = rollout("user");
    h.send("OfficeConnect");
    h.send("UserPromptSubmit", { turn_id: "turn-1", transcript_path });
    h.send("PreToolUse", { ...call, transcript_path });
    h.send("PermissionRequest", { turn_id: "turn-1", tool_name: "Bash", tool_input: call.tool_input, transcript_path });
    appendFileSync(transcript_path, `${JSON.stringify({ type: "event_msg", payload: { type: "item_completed", item: { type: "CommandExecution", id: "call-1", status: "declined" } } })}\n`);
    h.send("Stop", { turn_id: "turn-1", transcript_path });
    expect(h.session().characters).toMatchObject([{ id: "call-1", status: "denied" }]);
  });

  test("권한 상승 사유가 붙은 허용 요청도 입력이 같은 호출을 찾는다", () => {
    const h = harness();
    const other = { ...call, tool_use_id: "call-2", tool_input: { command: "ls" } };
    h.send("OfficeConnect");
    h.send("PreToolUse", call);
    h.send("PreToolUse", other);
    h.send("PermissionRequest", { turn_id: call.turn_id, tool_name: "Bash", tool_input: { ...call.tool_input, description: "샌드박스 밖에서 실행" } });
    expect(h.session().characters).toMatchObject([{ id: "call-1", status: "waiting" }, { id: "call-2", status: "working" }]);
  });
  test("MCP description을 보존해 실제 승인 대상만 대기로 표시한다", () => {
    const h = harness();
    const a = { ...call, tool_name: "mcp__tasks__create", tool_input: { description: "first" } };
    const b = { ...a, tool_use_id: "call-2", tool_input: { description: "second" } };
    h.send("OfficeConnect");
    h.send("PreToolUse", a);
    h.send("PreToolUse", b);
    h.send("PermissionRequest", { tool_name: a.tool_name, tool_input: a.tool_input });
    h.send("PostToolUse", b);
    expect(h.session().characters).toMatchObject([{ id: "call-1", status: "waiting" }]);
  });

  test("다음 hook 없이 기록 감시로 거절을 표시한다", () => {
    const h = harness();
    const transcript_path = rollout("user");
    h.send("OfficeConnect");
    h.send("PreToolUse", { ...call, transcript_path });
    h.send("PermissionRequest", call);
    appendOutcome(transcript_path);
    follow.mock.calls.find((args) => args[0] === `codex:${h.id}`)![2]("");
    expect(h.session().characters).toMatchObject([{ id: "call-1", status: "denied" }]);
  });

  test.each(["Stop", "SessionEnd"])("%s 뒤 늦은 거절로 상태만 보정하고 완료 수를 중복 계산하지 않는다", (end) => {
    const h = harness();
    const transcript_path = rollout("user");
    h.send("OfficeConnect");
    h.send("PreToolUse", { ...call, transcript_path });
    h.send("PermissionRequest", call);
    h.send(end, { turn_id: "turn-1", transcript_path });
    expect(h.session().characters[0].status).toBe("cancelled");
    const count = h.session().doneCount;
    appendOutcome(transcript_path);
    const refresh = follow.mock.calls.find((args) => args[0] === `codex:${h.id}`)![2];
    refresh("");
    refresh("");
    expect(h.session().characters[0].status).toBe("denied");
    expect(h.session().doneCount).toBe(count);
    expect(h.session().inTurn).toBe(false);
  });

  test("PreToolUse를 놓친 대기도 같은 턴의 명령으로 id를 복구한다", () => {
    const h = harness();
    const transcript_path = rollout("user");
    h.send("OfficeConnect");
    h.send("PermissionRequest", { turn_id: "turn-1", tool_name: "Bash", tool_input: { command: "pwd", description: "이유" }, transcript_path });
    appendOutcome(transcript_path);
    follow.mock.calls.find((args) => args[0] === `codex:${h.id}`)![2]("");
    expect(h.session().characters).toMatchObject([{ id: "call-1", status: "denied", orphan: false }]);
  });

  test("과거 턴의 같은 명령 거절은 새 턴의 orphan과 연결하지 않는다", () => {
    const h = harness();
    const transcript_path = rollout("user");
    appendOutcome(transcript_path);
    h.send("OfficeConnect");
    h.send("PermissionRequest", { turn_id: "new-turn", tool_name: "Bash", tool_input: { command: "pwd" }, transcript_path });
    follow.mock.calls.find((args) => args[0] === `codex:${h.id}`)![2]("");
    expect(h.session().characters).toMatchObject([{ status: "waiting", orphan: true }]);
  });

  test.each(["completed", "failed"])("PostToolUse 없이 %s가 기록된 호출을 턴 종료에서 실행 완료로 정리한다", (status) => {
    const h = harness();
    const transcript_path = rollout("user");
    h.send("OfficeConnect");
    h.send("PreToolUse", { ...call, transcript_path });
    appendOutcome(transcript_path, status);
    h.send("Stop", { turn_id: "turn-1", transcript_path });
    expect(h.session()).toMatchObject({ characters: [], doneCount: 1, inTurn: false, lit: false });
    h.send("PostToolUse", { ...call, transcript_path });
    expect(h.session().doneCount).toBe(1);
  });

  test.each(["completed", "failed"])("턴 종료 뒤 늦게 기록된 %s도 중단에서 실행 완료로 보정한다", (status) => {
    const h = harness();
    const transcript_path = rollout("user");
    h.send("OfficeConnect");
    h.send("PreToolUse", { ...call, transcript_path });
    h.send("Stop", { turn_id: "turn-1", transcript_path });
    expect(h.session().characters[0].status).toBe("cancelled");
    appendOutcome(transcript_path, status);
    const refresh = follow.mock.calls.find((args) => args[0] === `codex:${h.id}`)![2];
    refresh("");
    refresh("");
    expect(h.session()).toMatchObject({ characters: [{ status: "approved" }], doneCount: 1, inTurn: false, lit: false });
  });

  test("승인된 orphan도 PostToolUse에서 화면 id를 유지한다", () => {
    const h = harness();
    h.send("OfficeConnect");
    h.send("PermissionRequest", { turn_id: "turn-1", tool_name: "Bash", tool_input: { command: "pwd", description: "사유" } });
    const sceneId = h.session().characters[0].id;
    h.send("PostToolUse", call);
    expect(h.session().characters).toMatchObject([{ id: "call-1", sceneId, status: "approved", orphan: false }]);
  });

  test("늦게 기록된 실행 결과로 승인 대기를 보정해도 완료 수는 한 번만 늘린다", () => {
    const h = harness();
    const transcript_path = rollout("user");
    h.send("OfficeConnect");
    h.send("PermissionRequest", { turn_id: "turn-1", tool_name: "Bash", tool_input: { command: "pwd" }, transcript_path });
    const sceneId = h.session().characters[0].id;
    h.send("Stop", { turn_id: "turn-1", transcript_path });
    appendOutcome(transcript_path, "completed");
    const refresh = follow.mock.calls.find((args) => args[0] === `codex:${h.id}`)![2];
    refresh("");
    refresh("");
    expect(h.session()).toMatchObject({ doneCount: 1, characters: [{ id: "call-1", sceneId, status: "approved" }] });
  });

  test.each(["completed", "declined"])("같은 턴의 과거 %s 결과를 새 orphan에 붙이지 않는다", (status) => {
    const h = harness();
    const transcript_path = rollout("user");
    h.send("OfficeConnect");
    h.send("PreToolUse", { ...call, transcript_path });
    appendOutcome(transcript_path, status, h.time());
    h.send("PostToolUse", { ...call, transcript_path });
    h.advance(9000);
    h.send("PermissionRequest", { turn_id: "turn-1", tool_name: "Bash", tool_input: call.tool_input, transcript_path });
    expect(h.session().characters).toMatchObject([{ status: "waiting", orphan: true }]);
    expect(h.session().characters[0].id).not.toBe("call-1");
  });

  test("완료 시각이 없는 기록은 orphan ID 복구에 쓰지 않는다", () => {
    const h = harness();
    const transcript_path = rollout("user");
    h.send("OfficeConnect");
    h.send("PermissionRequest", { turn_id: "turn-1", tool_name: "Bash", tool_input: call.tool_input, transcript_path });
    appendOutcome(transcript_path, "completed", NaN);
    follow.mock.calls.find((args) => args[0] === `codex:${h.id}`)![2]("");
    expect(h.session().characters).toMatchObject([{ status: "waiting", orphan: true }]);
  });

  test("기록이 PostToolUse보다 먼저 와도 동일 입력의 허용 대기를 바로잡는다", () => {
    const h = harness();
    const transcript_path = rollout("user");
    const other = { ...call, tool_use_id: "call-2" };
    h.send("OfficeConnect");
    h.send("PreToolUse", { ...call, transcript_path });
    h.send("PreToolUse", other);
    h.send("PermissionRequest", { turn_id: "turn-1", tool_name: "Bash", tool_input: call.tool_input });
    appendOutcome(transcript_path, "completed", h.time());
    h.send("PostToolUse", { ...call, transcript_path });
    expect(h.session().characters).toMatchObject([{ id: "call-1", status: "approved" }, { id: "call-2", status: "working" }]);
    expect(h.session().doneCount).toBe(1);
  });

  test.each([
    ["failed", false], ["failed", true], ["completed", false], ["completed", true],
  ] as const)("Esc 이후 %s는 중단으로 유지한다 (시각 없음 %s)", (status, missingTime) => {
    const h = harness();
    const transcript_path = rollout("user");
    h.send("OfficeConnect");
    h.send("PreToolUse", { ...call, transcript_path });
    h.send("Interrupt", { turn_id: "turn-1", transcript_path });
    appendOutcome(transcript_path, status, missingTime ? NaN : h.time() + 1);
    h.send("SessionEnd", { transcript_path });
    expect(h.session()).toMatchObject({ characters: [{ status: "cancelled" }], doneCount: 1 });
  });

  test.each(["failed", "completed"])("Esc 전에 끝난 %s가 늦게 저장되면 실행 완료로 복구한다", (status) => {
    const h = harness();
    const transcript_path = rollout("user");
    h.send("OfficeConnect");
    h.send("PreToolUse", { ...call, transcript_path });
    const completedAt = h.time();
    h.send("Interrupt", { turn_id: "turn-1", transcript_path });
    appendOutcome(transcript_path, status, completedAt);
    h.send("SessionEnd", { transcript_path });
    expect(h.session()).toMatchObject({ characters: [{ status: "approved" }], doneCount: 1 });
  });

});

function rollout(reviewer: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "office-codex-")), "rollout.jsonl");
  writeFileSync(path, `${JSON.stringify({ type: "event_msg", payload: { type: "thread_settings_applied", thread_settings: { approvals_reviewer: reviewer } } })}\n`);
  return path;
}

function appendOutcome(path: string, status = "declined", completedAt = Date.now() + 1000) {
  appendFileSync(path, `${JSON.stringify({ type: "event_msg", payload: {
    type: "item_completed", turn_id: "turn-1", completed_at_ms: completedAt,
    item: { type: "CommandExecution", id: "call-1", status, command: ["/bin/zsh", "-lc", "pwd"] },
  } })}\n`);
}
