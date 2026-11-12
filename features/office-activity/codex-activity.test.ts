import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createCodexActivityReader } from "./codex-activity";
import { findCodexTranscript } from "./codex-transcript-path";

const row = (type: string, payload: unknown, at = 1_000) => JSON.stringify({ type, timestamp: new Date(at).toISOString(), payload });
const start = (id = "t1", at = 1_000) => row("event_msg", { type: "task_started", turn_id: id }, at);
const call = (id = "c1", at = 2_000) => row("response_item", { type: "custom_tool_call", name: "exec", call_id: id, input: "private code" }, at);
const output = (id = "c1", at = 3_000) => row("response_item", { type: "custom_tool_call_output", call_id: id, output: "Script completed\nWall time 1s\nOutput:\nprivate output" }, at);

describe("Codex 기록 활동 복구", () => {
  test("부모 종료에 root_turn_id가 없어도 연결 직후 종료 상태를 복구한다", () => {
    const reader = createCodexActivityReader();
    reader.read([
      row("event_msg", { type: "task_started", turn_id: "child", root_turn_id: "parent" }),
      row("event_msg", { type: "task_complete", turn_id: "parent" }, 2_000),
    ].join("\n"));
    expect(reader.snapshot().map((activity) => activity.event)).toEqual([
      { hook_event_name: "UserPromptSubmit", turn_id: "parent" },
      { hook_event_name: "Stop", turn_id: "parent" },
    ]);
  });

  test.each(["task_complete", "turn_aborted"])("하위 턴 시작 뒤 부모의 %s로 종료한다", (type) => {
    const reader = createCodexActivityReader();
    expect(reader.read(row("event_msg", { type: "task_started", turn_id: "review-child", root_turn_id: "parent" })))
      .toMatchObject([{ event: { hook_event_name: "UserPromptSubmit", turn_id: "parent" } }]);
    expect(reader.read(row("event_msg", { type, turn_id: "parent", root_turn_id: "parent" }, 2_000)))
      .toMatchObject([{ event: { hook_event_name: "Stop", turn_id: "parent" } }]);
    expect(reader.snapshot()).toHaveLength(2);
  });

  test("부모 ID가 없는 하위 턴 도구 기록도 시작·결과를 연결한다", () => {
    const reader = createCodexActivityReader();
    reader.read(row("event_msg", { type: "task_started", turn_id: "child", root_turn_id: "parent" }));
    const metadata = { turn_id: "child" };
    expect(reader.read(row("response_item", { type: "custom_tool_call", name: "exec", call_id: "c", internal_chat_message_metadata_passthrough: metadata })))
      .toMatchObject([{ event: { hook_event_name: "PreToolUse", turn_id: "parent" } }]);
    expect(reader.read(row("response_item", { type: "custom_tool_call_output", call_id: "c", output: "done", internal_chat_message_metadata_passthrough: metadata })))
      .toMatchObject([{ event: { hook_event_name: "PostToolUse", turn_id: "parent" } }]);
  });

  test("같은 부모의 하위 턴 시작으로 열린 부모 호출을 중단하지 않는다", () => {
    const reader = createCodexActivityReader();
    reader.read([start("parent"), call()].join("\n"));
    expect(reader.read(row("event_msg", { type: "task_started", turn_id: "child", root_turn_id: "parent" }, 3_000))).toEqual([]);
    expect(reader.snapshot()).toHaveLength(2);
    expect(reader.read(row("event_msg", { type: "task_complete", turn_id: "child", root_turn_id: "parent" }, 4_000)))
      .toMatchObject([{ event: { hook_event_name: "Stop", turn_id: "parent" } }]);
  });

  test("다른 부모 턴으로 넘어간 뒤 지난 부모의 종료와 도구 결과는 무시한다", () => {
    const reader = createCodexActivityReader();
    reader.read(row("event_msg", { type: "task_started", turn_id: "child", root_turn_id: "old" }));
    reader.read(start("new", 2_000));
    expect(reader.read(row("event_msg", { type: "task_complete", turn_id: "old", root_turn_id: "old" }, 3_000))).toEqual([]);
    expect(reader.read(row("response_item", { type: "custom_tool_call", name: "exec", call_id: "late", internal_chat_message_metadata_passthrough: { turn_id: "child" } }, 4_000))).toEqual([]);
    expect(reader.snapshot()).toHaveLength(1);
    expect(reader.snapshot()[0].turnIds).not.toContain("child");
  });

  test("열린 호출이 있는 채 새 턴을 읽으면 정리 신호를 먼저 보낸다", () => {
    const reader = createCodexActivityReader();
    reader.read([start(), call()].join("\n"));
    expect(reader.read(start("t2", 3_000)).map((e) => e.event)).toEqual([
      { hook_event_name: "CodexTranscriptSuperseded", turn_id: "t1" },
      { hook_event_name: "UserPromptSubmit", turn_id: "t2" },
    ]);
    expect(reader.read(start("t2", 3_000))).toEqual([]);
    expect(reader.snapshot()).toHaveLength(1);
  });
  test("연결 전 완료 호출은 되살리지 않고 마지막 종료 상태만 복구한다", () => {
    const reader = createCodexActivityReader();
    reader.read([start(), call(), output(), row("event_msg", { type: "task_complete", turn_id: "t1" }, 4_000)].join("\n"));
    expect(reader.snapshot().map((a) => a.event.hook_event_name)).toEqual(["UserPromptSubmit", "Stop"]);
  });

  test("생각 중인 턴과 아직 실행 중인 호출만 복구하며 본문을 복사하지 않는다", () => {
    const reader = createCodexActivityReader();
    reader.read([start(), call(), output(), call("c2", 4_000)].join("\n"));
    expect(reader.snapshot()).toMatchObject([
      { event: { hook_event_name: "UserPromptSubmit", turn_id: "t1" } },
      { event: { hook_event_name: "PreToolUse", tool_use_id: "codex-transcript:c2", tool_name: "코드 실행", tool_input: null } },
    ]);
    expect(JSON.stringify(reader.snapshot())).not.toContain("private");
  });

  test("yield 후 wait가 끝날 때 원래 호출을 완료한다", () => {
    const reader = createCodexActivityReader();
    reader.read([start(), call()].join("\n"));
    const yielded = row("response_item", { type: "custom_tool_call_output", call_id: "c1", output: "Script running with cell ID cell-1\nWall time 1s\nOutput:\n" });
    expect(reader.read(yielded)).toEqual([]);
    expect(reader.read(row("response_item", { type: "function_call", name: "wait", call_id: "w1", arguments: '{"cell_id":"cell-1"}' }))).toEqual([]);
    const events = reader.read(row("response_item", { type: "function_call_output", call_id: "w1", output: [{ type: "input_text", text: "Script completed\nWall time 1s\nOutput:\n" }] }, 4_000));
    expect(events).toMatchObject([{ event: { hook_event_name: "PostToolUse", tool_use_id: "codex-transcript:c1" } }]);
    expect(reader.snapshot()).toHaveLength(1);
  });

  test("이전 턴의 늦은 종료와 결과를 새 턴에 적용하지 않는다", () => {
    const reader = createCodexActivityReader();
    reader.read([start(), call(), start("t2", 3_000), call("c2", 4_000)].join("\n"));
    expect(reader.read([row("event_msg", { type: "task_complete", turn_id: "t1" }, 5_000), output("c1", 6_000)].join("\n"))).toEqual([]);
    expect(reader.snapshot()).toHaveLength(2);
  });

  test("Esc 중단 뒤 늦은 결과로 실행을 되살리지 않는다", () => {
    const reader = createCodexActivityReader();
    reader.read([start(), call()].join("\n"));
    expect(reader.read(row("event_msg", { type: "turn_aborted", turn_id: "t1" }, 3_000))).toMatchObject([
      { event: { hook_event_name: "Stop", stop_reason: "interrupt" } },
    ]);
    expect(reader.read(output("c1", 4_000))).toEqual([]);
  });

  test("일반 도구 호출도 표시하고 중복 결과는 무시한다", () => {
    const reader = createCodexActivityReader();
    reader.read(start());
    expect(reader.read(row("response_item", { type: "function_call", name: "mcp__test__read", call_id: "m1", arguments: "{}" }))).toMatchObject([
      { event: { tool_name: "mcp__test__read" } },
    ]);
    const done = row("response_item", { type: "function_call_output", call_id: "m1", output: "ok" });
    expect(reader.read(done)).toHaveLength(1);
    expect(reader.read(done)).toEqual([]);
  });

  test("명시한 세션의 파일 이름만 찾아 연결하며 다른 ID는 선택하지 않는다", () => {
    const home = mkdtempSync(join(tmpdir(), "office-discovery-"));
    const dir = join(home, "sessions", "2026", "11", "12");
    mkdirSync(dir, { recursive: true });
    const id = crypto.randomUUID();
    const path = join(dir, `rollout-date-${id}.jsonl`);
    writeFileSync(path, "contents need not be parsed");
    expect(findCodexTranscript(id, home)).toBe(path);
    expect(findCodexTranscript(crypto.randomUUID(), home)).toBeUndefined();
    expect(findCodexTranscript("../../sessions", home)).toBeUndefined();
  });
});
