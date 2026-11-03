import { describe, expect, test } from "vitest";

import { applyPlanCall } from "./task-plan";
import type { PlanItem } from "./types";

const UPDATE = "mcp__ccd_turn__update_plan";
const three: PlanItem[] = [
  { content: "코드 찾기", status: "completed" },
  { content: "고치기", status: "in_progress" },
  { content: "확인", status: "pending" },
];

describe("task 목록 반영", () => {
  test("update_plan의 전체 목록은 지금 목록을 바꾼다", () => {
    const plan = applyPlanCall(undefined, UPDATE, {
      items: [{ content: "코드 찾기", status: "in_progress" }, { content: "고치기", status: "pending" }],
      scope: "first_task",
    });
    expect(plan).toEqual([
      { content: "코드 찾기", status: "in_progress" },
      { content: "고치기", status: "pending" },
    ]);
  });

  test("advance는 진행 중인 항목을 끝내고 다음 항목을 시작한다", () => {
    expect(applyPlanCall(three, UPDATE, { advance: true })?.map((i) => i.status)).toEqual([
      "completed", "completed", "in_progress",
    ]);
  });

  test("done과 start는 1부터 센 번호로 항목을 끝내고 시작한다", () => {
    const plan = applyPlanCall(three, UPDATE, { done: [2], start: 3 });
    expect(plan?.map((i) => i.status)).toEqual(["completed", "completed", "in_progress"]);
  });

  test("wrap_up은 남은 항목을 모두 끝낸다", () => {
    const plan = applyPlanCall(three, "mcp__ccd_turn__wrap_up", { recap: "끝" });
    expect(plan?.every((i) => i.status === "completed")).toBe(true);
  });

  test("목록이 없을 때 advance나 wrap_up이 와도 목록을 만들지 않는다", () => {
    expect(applyPlanCall(undefined, UPDATE, { advance: true })).toBeUndefined();
    expect(applyPlanCall(undefined, "mcp__ccd_turn__wrap_up", {})).toBeUndefined();
  });

  test("CLI의 TodoWrite는 todos로 전체 목록을 바꾼다", () => {
    const plan = applyPlanCall(three, "TodoWrite", {
      todos: [{ content: "테스트", status: "completed", activeForm: "테스트하는 중" }],
    });
    expect(plan).toEqual([{ content: "테스트", status: "completed" }]);
  });

  test("TodoWrite가 빈 목록을 보내면 목록을 지운다", () => {
    expect(applyPlanCall(three, "TodoWrite", { todos: [] })).toBeUndefined();
  });
});
