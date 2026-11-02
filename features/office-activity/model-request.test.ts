import { describe, expect, test } from "vitest";

import { latestModelRequestAt } from "./model-request";

// 실제 transcript와 같은 모양의 줄들이다.
const request = (timestamp: string, querySource = "repl_main_thread:outputStyle:custom", extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "api-request", sessionId: "s", timestamp, querySource, ...extra });

describe("본 세션 모델 호출 찾기", () => {
  test("본 세션 모델 호출 가운데 가장 늦은 시각을 준다", () => {
    const lines = [request("2026-11-02T09:06:40.000Z"), request("2026-11-02T09:06:42.000Z")].join("\n");

    expect(latestModelRequestAt(lines)).toBe(Date.parse("2026-11-02T09:06:42.000Z"));
  });

  test("다른 출처의 호출, sub-agent 호출, 호출 내용 기록, 다른 줄은 보지 않는다", () => {
    const lines = [
      request("2026-11-02T09:06:40.000Z", "compact"),
      request("2026-11-02T09:06:41.000Z", undefined, { isSidechain: true }),
      JSON.stringify({ type: "api-request-blob", timestamp: "2026-11-02T09:06:42.000Z" }),
      JSON.stringify({ type: "user", message: { content: '"api-request"' } }),
    ].join("\n");

    expect(latestModelRequestAt(lines)).toBeUndefined();
  });
});
