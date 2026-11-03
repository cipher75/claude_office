import { describe, expect, test } from "vitest";

import { readTurnInterruptions } from "./turn-interrupt";

// 실제 transcript와 같은 모양의 줄들이다.
const timestamp = "2026-11-03T00:00:00.000Z";
const userText = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "user", isSidechain: false, timestamp, message: { role: "user", content: [{ type: "text", text }] }, ...extra });
const result = (id: string) => JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id }] } });
const read = (lines: string) => readTurnInterruptions({}, lines).interruptions;

describe("사용자 중단 찾기", () => {
  test("본 세션의 중단 메시지에서 기록 시각을 읽는다", () => {
    expect(read(userText("[Request interrupted by user]"))).toEqual([{ kind: "turn", at: Date.parse(timestamp) }]);
    expect(read(userText("[Request interrupted by user for tool use]")))
      .toEqual([{ kind: "tool", at: Date.parse(timestamp), toolUseId: undefined }]);
    expect(read(JSON.stringify({ type: "user", timestamp, message: { content: "[Request interrupted by user]" } })))
      .toEqual([{ kind: "turn", at: Date.parse(timestamp) }]);
  });

  test("API 요청 기록이나 sub-agent의 중단, 대화 속 인용은 중단으로 보지 않는다", () => {
    const blob = JSON.stringify({ type: "api-request-blob", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]\n" }] } });
    const sidechain = userText("[Request interrupted by user]", { isSidechain: true });
    const quoted = userText("방금 [Request interrupted by user] 가 떴어요");

    expect(read([blob, sidechain, quoted].join("\n"))).toEqual([]);
  });

  test("중단 메시지가 여럿이면 각 중단의 종류와 시각을 읽는다", () => {
    const later = "2026-11-03T00:00:01.000Z";
    const lines = [
      userText("[Request interrupted by user]", { timestamp: later }),
      userText("[Request interrupted by user]"),
    ].join("\n");

    expect(read(lines)).toEqual([{ kind: "turn", at: Date.parse(later) }, { kind: "turn", at: Date.parse(timestamp) }]);
  });

  test("시각을 읽지 못한 중단도 관측하되 깨진 줄은 무시한다", () => {
    const lines = [
      userText("[Request interrupted by user]", { timestamp: undefined }),
      userText("[Request interrupted by user]", { timestamp: "invalid" }),
      userText("[Request interrupted by user]", { timestamp: 1234 }),
      "깨진 줄 {",
    ].join("\n");

    expect(read(lines)).toEqual(Array(3).fill({ kind: "turn", at: undefined }));
  });

  test("도구 중단은 바로 앞 결과의 호출 id를 함께 읽는다", () => {
    expect(read([result("old-call"), userText("[Request interrupted by user for tool use]")].join("\n")))
      .toEqual([{ kind: "tool", at: Date.parse(timestamp), toolUseId: "old-call" }]);
  });

  test.each([false, true])("같은 줄의 결과가 있으면 앞 줄의 id보다 우선한다(앞선 결과: %s)", (previous) => {
    const combined = userText("[Request interrupted by user for tool use]", {
      message: { content: [
        { type: "text", text: "[Request interrupted by user for tool use]" },
        { type: "tool_result", tool_use_id: "current-call" },
      ] },
    });

    expect(read([...(previous ? [result("old-call")] : []), combined].join("\n")))
      .toEqual([{ kind: "tool", at: Date.parse(timestamp), toolUseId: "current-call" }]);
  });

  test("결과와 중단을 나눠 읽어도 호출 id를 기억한다", () => {
    const first = readTurnInterruptions({}, result("old-call"));
    const second = readTurnInterruptions(first.state, userText("[Request interrupted by user for tool use]"));

    expect(second.interruptions[0]).toMatchObject({ kind: "tool", toolUseId: "old-call" });
  });

  test("다른 기록이 끼면 지난 결과를 도구 중단에 붙이지 않는다", () => {
    const lines = [result("old-call"), JSON.stringify({ type: "assistant", message: { content: [] } }),
      userText("[Request interrupted by user for tool use]")].join("\n");

    expect(read(lines)[0].toolUseId).toBeUndefined();
  });
});
