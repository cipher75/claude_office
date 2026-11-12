import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { emptyReaderState, followTranscript, readCallOutcomes, stopFollowing, type ReaderState } from "./transcript-watch";

// 실제 transcript와 같은 모양의 줄들이다. 결과 줄 바로 다음에 PostToolUse hook 기록이 붙으면 실행된 호출이다.
function result(toolUseId: string, content = "done", toolUseResult: unknown = {}) {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content }] },
    toolUseResult,
  });
}
function postRecord(toolUseId: string, type = "hook_success", hook = "PostToolUse") {
  return JSON.stringify({ type: "attachment", attachment: { type, hookName: `${hook}:Bash`, toolUseID: toolUseId } });
}
const interrupted = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] } });
const assistant = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "다음" }] } });

function read(lines: string[], state: ReaderState = emptyReaderState()) {
  return readCallOutcomes(state, lines.join("\n"));
}

describe("호출의 실행 여부 읽기", () => {
  test("결과 줄 다음에 PostToolUse 기록이 오면 실행된 것이다", () => {
    expect(read([result("t1"), postRecord("t1")]).outcomes).toEqual([{ toolUseId: "t1", executed: true, async: false, rejected: false }]);
  });

  test("서버가 실패해 hook 오류로 기록되어도, PostToolUseFailure 기록이어도 실행된 것이다", () => {
    const lines = [result("t1"), postRecord("t1", "hook_non_blocking_error"), result("t2"), postRecord("t2", "hook_success", "PostToolUseFailure")];

    expect(read(lines).outcomes.map((o) => [o.toolUseId, o.executed, o.failed === true])).toEqual([["t1", true, false], ["t2", true, true]]);
  });

  test("결과 줄 다음에 다른 종류의 줄이 오면 문구와 상관없이 실행되지 않은 것이다", () => {
    const lines = [
      result("no-1", "The user doesn't want to proceed with this tool use.", "User rejected tool use"),
      interrupted,
      result("no-2", "Permission to use Bash with command rm has been denied.", "Error: Permission to use Bash"),
      assistant,
    ];

    expect(read(lines).outcomes.map((o) => [o.toolUseId, o.executed])).toEqual([["no-1", false], ["no-2", false]]);
  });

  test("실행되지 않은 호출은 Claude Code의 거절 결과 값이 있을 때만 거절로 표시한다", () => {
    // 실제 Claude Code 2.1.307의 결과 문구들이다. 아래 넷은 "Nobody refused it"라고 적힌 거절이 아닌 경우다.
    const lines = [
      result("rej-1", "The user doesn't want to proceed with this tool use. The tool use was rejected.", "User rejected tool use"),
      interrupted,
      result("rej-2", "Error: The user doesn't want to proceed with this tool use. STOP.", "Error: The user doesn't want to proceed with this tool use."),
      assistant,
      result("closed", "[Tool call not completed: an approval request was still unanswered when the message that follows arrived and was closed, so the action awaiting approval did not run. Nobody refused it, so this is not the user's decision; ask again if it is still needed.]"),
      assistant,
      result("expired", "[Tool call not completed: an approval request expired with no answer, so the action awaiting approval did not run. Nobody refused it, so this is not the user's decision; ask again if it is still needed.]"),
      assistant,
      result("esc", "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed."),
      interrupted,
      result("rule", "Permission to use Bash with command rm -rf x has been denied.", "Error: Permission to use Bash with command rm -rf x has been denied."),
      assistant,
    ];

    expect(read(lines).outcomes.map((o) => [o.toolUseId, o.executed, o.rejected])).toEqual([
      ["rej-1", false, true],
      ["rej-2", false, true],
      ["closed", false, false],
      ["expired", false, false],
      ["esc", false, false],
      ["rule", false, false],
    ]);
  });

  test("세션이 끊겨 결과를 모른다고 적힌 호출은 실행 여부를 판단하지 않는다", () => {
    // 실제 Claude Code 2.1.304가 세션을 다시 이을 때 끝나지 않은 호출에 붙이는 결과다. 실행되었을 수도 있다.
    const unknown = "[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown. Check whether it took effect before relying on it or running it again.]";
    const lines = [result("lost-1", unknown, unknown), result("lost-2", unknown, unknown), result("t1"), postRecord("t1"), assistant];

    expect(read(lines).outcomes.map((o) => [o.toolUseId, o.executed])).toEqual([["t1", true]]);
  });

  test("병렬 호출의 결과 줄이 이어져도 각자의 기록으로 판단한다", () => {
    const lines = [result("a"), result("b"), postRecord("a"), assistant];

    expect(read(lines).outcomes.map((o) => [o.toolUseId, o.executed])).toEqual([["a", true], ["b", false]]);
  });

  test("다음 줄이 아직 없으면 판단을 미루고, 이어서 읽은 줄로 판단한다", () => {
    const first = read([result("t1")]);
    expect(first).toEqual({ state: { pending: [{ toolUseId: "t1", async: false, rejected: false }], calls: {} }, outcomes: [] });

    expect(read([postRecord("t1")], first.state).outcomes).toEqual([{ toolUseId: "t1", executed: true, async: false, rejected: false }]);
  });

  test("모델이 부른 호출의 도구·입력·시각을 기억했다가 그 호출의 판단에 붙인다", () => {
    const timestamp = "2026-11-03T01:43:07.000Z";
    const call = JSON.stringify({
      type: "assistant", timestamp,
      message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "git push" } }] },
    });
    const first = read([call, result("t1")]);
    const second = read([interrupted], first.state);

    expect(second.outcomes).toEqual([
      { toolUseId: "t1", executed: false, async: false, rejected: false, toolName: "Bash", toolInput: { command: "git push" }, startedAt: Date.parse(timestamp) },
    ]);
    expect(second.state.calls).toEqual({});
  });

  test("백그라운드로 시작만 알린 결과는 async로 표시한다", () => {
    const lines = [result("a1", "Async agent launched", { isAsync: true, status: "async_launched" }), postRecord("a1")];

    expect(read(lines).outcomes).toEqual([{ toolUseId: "a1", executed: true, async: true, rejected: false }]);
  });

  test("백그라운드로 시작한 결과에서 시작한 sub-agent의 id를 함께 넘긴다", () => {
    const lines = [
      result("a1", "Async agent launched", { isAsync: true, status: "async_launched", agentId: "agent-1" }),
      postRecord("a1"),
    ];

    expect(read(lines).outcomes).toEqual([{ toolUseId: "a1", executed: true, async: true, agentId: "agent-1", rejected: false }]);
  });

  test("대화 중에 tool_result를 언급한 메시지는 결과로 보지 않는다", () => {
    const quoted = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: '{"type":"tool_result","tool_use_id":"x"}' }] },
    });

    expect(read([quoted, "깨진 줄 {"])).toEqual({ state: emptyReaderState(), outcomes: [] });
  });
});

describe("transcript 지켜보기", () => {
  const session = "watch-test";
  afterEach(() => stopFollowing(session));

  test("초기 읽기와 감시 등록 사이에 붙은 줄과 미완성 UTF-8 줄도 놓치지 않는다", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "office-")), "session.jsonl");
    const old = '{"text":"이전"}\n';
    const next = '{"text":"생각 중"}\n';
    writeFileSync(path, old + next.slice(0, 6));
    const offset = Buffer.byteLength(old);
    appendFileSync(path, next.slice(6));
    const seen: string[] = [];
    followTranscript(session, path, (lines) => seen.push(lines), offset);
    await expect.poll(() => seen, { timeout: 3_000 }).toEqual([next.trim()]);
  });

  test("지켜보기 시작한 뒤 붙은 완성된 줄만 넘긴다", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "office-")), "session.jsonl");
    writeFileSync(path, `${result("old")}\n${assistant}\n`);
    const seen: string[] = [];

    followTranscript(session, path, (lines) => seen.push(...lines.split("\n")));
    const next = result("t2");
    appendFileSync(path, `${result("t1")}\n${next.slice(0, 20)}`);
    appendFileSync(path, `${next.slice(20)}\n`);

    await expect.poll(() => seen, { timeout: 3_000 }).toEqual([result("t1"), next]);
  });
});
