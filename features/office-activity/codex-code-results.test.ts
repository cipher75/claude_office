import { describe, expect, test } from "vitest";
import { createCodexCodeReader } from "./codex-code-results";

const reason = 'exec_command failed: CreateProcess { message: "Rejected("rejected by user")" }';
const meta = (at: number, turn = "turn-1") => ({ turn_id: turn, create_time: at / 1000 });
const call = (id = "code-1", at = 1_000, turn = "turn-1", input = 'const r=await tools.exec_command({cmd:"pwd",prefix_rule:["pwd"]});text(r.output);') => ({
  type: "custom_tool_call", name: "exec", call_id: id, input, internal_chat_message_metadata_passthrough: meta(at, turn),
});
const blocks = (header: string, ...texts: string[]) => [header + "\nWall time 1 seconds\nOutput:\n", ...texts].map((text) => ({ type: "input_text", text }));
const result = (output: unknown, id = "code-1", at = 2_000, turn = "turn-1", type = "custom_tool_call_output") => ({
  type, call_id: id, output, internal_chat_message_metadata_passthrough: meta(at, turn),
});
const wait = (id = "wait-1", cell = "g2:1", at = 3_000, turn = "turn-1", terminate = false) => ({
  type: "function_call", name: "wait", call_id: id, arguments: JSON.stringify({ cell_id: cell, terminate }),
  internal_chat_message_metadata_passthrough: meta(at, turn),
});
const rejected = () => blocks("Script failed", `Script error:\n${reason}`);
function pending() {
  const reader = createCodexCodeReader();
  reader.read(call());
  reader.read(result(blocks("Script running with cell ID g2:1")));
  return reader;
}

describe("Codex 코드 실행의 후속 wait 결과", () => {
  test("yield 시에는 호출을 닫지 않고 최종 거절을 원래 코드 호출에 연결한다", () => {
    const reader = pending();
    expect(reader.calls.get("code-1")?.completedAt).toBeUndefined();
    reader.read(wait());
    reader.read(result(JSON.stringify(rejected()), "wait-1", 4_000, "turn-1", "function_call_output"));
    expect(reader.calls.get("code-1")?.completedAt).toBe(4_000);
    expect(reader.rejections).toEqual([{
      callId: "code-1", wrapperCallId: "code-1", turnId: "turn-1", commands: ["pwd"], startedAt: 1_000, completedAt: 4_000,
    }]);
  });

  test("실제 native의 빈 yield 문자열도 cell ID와 연결한다", () => {
    const reader = createCodexCodeReader();
    reader.read(call());
    reader.read(result("Script running with cell ID g2:1\nWall time 1.0 seconds\nOutput:\n"));
    reader.read(wait());
    reader.read(result(rejected(), "wait-1", 4_000, "turn-1", "function_call_output"));
    expect(reader.rejections).toMatchObject([{ wrapperCallId: "code-1", completedAt: 4_000 }]);
  });

  test("본문이 있는 비구조적 yield 문자열은 임의의 출력 블록으로 나누지 않는다", () => {
    const reader = createCodexCodeReader();
    reader.read(call());
    reader.read(result("Script running with cell ID g2:1\nWall time 1.0 seconds\nOutput:\nunknown output"));
    reader.read(wait());
    reader.read(result(rejected(), "wait-1", 4_000, "turn-1", "function_call_output"));
    expect(reader.rejections).toEqual([]);
  });

  test("여러 wait에 나뉜 출력과 앞뒤 일반 출력을 원래 순서로 합친다", () => {
    const reader = createCodexCodeReader();
    reader.read(call("code-1", 1_000, "turn-1", 'text(await tools.write_stdin({session_id:1,chars:""})); const r=await Promise.allSettled([tools.exec_command({cmd:"pwd",prefix_rule:["pwd"]}),tools.exec_command({cmd:"ls"})]);r.forEach((v,i)=>text({part:i,...v})); text(await tools.write_stdin({session_id:2,chars:""}));'));
    reader.read(result(JSON.stringify(blocks("Script running with cell ID g2:1", "prefix"))));
    reader.read(wait());
    const partial = result(blocks("Script still running with cell ID g2:1", JSON.stringify({ part: 0, status: "rejected", reason })), "wait-1", 4_000, "turn-1", "function_call_output");
    reader.read(partial);
    reader.read(partial);
    expect(reader.rejections).toEqual([]);
    expect(reader.calls.get("code-1")?.completedAt).toBeUndefined();
    reader.read(wait("wait-2", "g2:1", 5_000));
    const final = result(blocks("Script completed", JSON.stringify({ part: 1, status: "fulfilled", value: {} }), "suffix"), "wait-2", 6_000, "turn-1", "function_call_output");
    reader.read(final);
    reader.read(final);
    expect(reader.rejections).toMatchObject([{ callId: "code-1:0", commands: ["pwd"], completedAt: 6_000 }]);
  });

  test.each(["completed", "terminated"])("%s 결과는 거절로 바꾸지 않는다", (status) => {
    const reader = pending();
    reader.read(wait());
    reader.read(result(blocks(`Script ${status}`, reason), "wait-1", 4_000, "turn-1", "function_call_output"));
    expect(reader.calls.get("code-1")?.completedAt).toBe(4_000);
    expect(reader.rejections).toEqual([]);
  });

  test("terminate 요청의 결과에 거절 오류가 있어도 거절 결정으로 쓰지 않는다", () => {
    const reader = pending();
    reader.read(wait("wait-1", "g2:1", 3_000, "turn-1", true));
    reader.read(result(rejected(), "wait-1", 4_000, "turn-1", "function_call_output"));
    expect(reader.calls.get("code-1")?.completedAt).toBe(4_000);
    expect(reader.rejections).toEqual([]);
  });

  test.each([
    ["알 수 없는 cell", wait("wait-1", "other")],
    ["다른 턴", wait("wait-1", "g2:1", 3_000, "turn-2")],
    ["이전 시각", wait("wait-1", "g2:1", 1_500)],
    ["잘못된 인수", { ...wait(), arguments: "{" }],
    ["숫자 cell", { ...wait(), arguments: '{"cell_id":1}' }],
  ])("%s의 wait는 연결하지 않는다", (_name, request) => {
    const reader = pending();
    reader.read(request);
    reader.read(result(rejected(), "wait-1", 4_000, "turn-1", "function_call_output"));
    expect(reader.rejections).toEqual([]);
    expect(reader.calls.get("code-1")?.completedAt).toBeUndefined();
  });

  test.each([
    ["다른 턴의 결과", result(rejected(), "wait-1", 4_000, "turn-2", "function_call_output")],
    ["요청 전 결과", result(rejected(), "wait-1", 2_500, "turn-1", "function_call_output")],
    ["잘못된 출력", result("not JSON", "wait-1", 4_000, "turn-1", "function_call_output")],
    ["알 수 없는 헤더", result(blocks("Unknown response", reason), "wait-1", 4_000, "turn-1", "function_call_output")],
    ["바뀐 cell", result(blocks("Script running with cell ID other"), "wait-1", 4_000, "turn-1", "function_call_output")],
  ])("%s로 원래 호출을 끝내지 않는다", (_name, output) => {
    const reader = pending();
    reader.read(wait());
    reader.read(output);
    expect(reader.rejections).toEqual([]);
    expect(reader.calls.get("code-1")?.completedAt).toBeUndefined();
  });

  test("같은 cell ID도 턴이 다르면 각각의 원래 코드에 연결한다", () => {
    const reader = pending();
    reader.read(call("code-2", 2_500, "turn-2"));
    reader.read(result(blocks("Script running with cell ID g2:1"), "code-2", 3_000, "turn-2"));
    reader.read(wait("wait-1", "g2:1", 3_500, "turn-1"));
    reader.read(wait("wait-2", "g2:1", 3_500, "turn-2"));
    reader.read(result(rejected(), "wait-2", 4_000, "turn-2", "function_call_output"));
    expect(reader.rejections).toMatchObject([{ wrapperCallId: "code-2", turnId: "turn-2" }]);
    expect(reader.calls.get("code-1")?.completedAt).toBeUndefined();
  });

  test("같은 턴의 재사용된 cell ID는 어느 코드에도 임의로 붙이지 않는다", () => {
    const reader = pending();
    reader.read(wait("wait-old", "g2:1", 2_100));
    reader.read(call("code-2", 2_500));
    reader.read(result(blocks("Script running with cell ID g2:1"), "code-2", 3_000));
    reader.read(wait("wait-1", "g2:1", 3_500));
    reader.read(result(rejected(), "wait-old", 4_000, "turn-1", "function_call_output"));
    reader.read(result(rejected(), "wait-1", 4_000, "turn-1", "function_call_output"));
    expect(reader.rejections).toEqual([]);
    expect([...reader.calls.values()].every((call) => call.completedAt === undefined)).toBe(true);
  });
});
