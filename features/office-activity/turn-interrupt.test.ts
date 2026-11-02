import { describe, expect, test } from "vitest";

import { hasInterruptedTurn } from "./turn-interrupt";

// 실제 transcript와 같은 모양의 줄들이다.
const userText = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "user", isSidechain: false, message: { role: "user", content: [{ type: "text", text }] }, ...extra });

describe("사용자 중단 찾기", () => {
  test("본 세션의 중단 메시지가 있으면 턴이 끝난 것이다", () => {
    expect(hasInterruptedTurn(userText("[Request interrupted by user]"))).toBe(true);
    expect(hasInterruptedTurn(userText("[Request interrupted by user for tool use]"))).toBe(true);
  });

  test("API 요청 기록이나 sub-agent의 중단, 대화 속 인용은 중단으로 보지 않는다", () => {
    const blob = JSON.stringify({ type: "api-request-blob", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]\n" }] } });
    const sidechain = userText("[Request interrupted by user]", { isSidechain: true });
    const quoted = userText("방금 [Request interrupted by user] 가 떴어요");

    expect(hasInterruptedTurn([blob, sidechain, quoted].join("\n"))).toBe(false);
  });
});
