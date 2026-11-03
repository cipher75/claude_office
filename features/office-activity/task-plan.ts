import type { PlanItem, PlanItemStatus } from "./types";

// 세션의 task 목록(계획 단계)은 따로 오는 hook이 없고, 목록을 고치는 도구 호출의 입력으로만 알 수 있다.
// - 데스크톱 앱: mcp__ccd_turn__update_plan. 입력이 전체 목록(items)이거나, 다음 단계로 넘기기(advance),
//   번호로 끝내고 시작하기(done, start, 1부터 센다)다. 턴을 마치는 mcp__ccd_turn__wrap_up은 남은 항목을 모두 끝낸다.
// - Claude Code CLI: TodoWrite. 입력이 언제나 전체 목록(todos)이다.

const PLAN_TOOLS = new Set(["mcp__ccd_turn__update_plan", "mcp__ccd_turn__wrap_up", "TodoWrite"]);
const CONTENT_MAX = 60;

export function isPlanTool(toolName: string | undefined): boolean {
  return toolName !== undefined && PLAN_TOOLS.has(toolName);
}

// 실행된 호출 하나를 지금 목록에 반영한다. 목록이 비면 undefined로 돌려 게시판이 원래 그림으로 돌아가게 한다.
export function applyPlanCall(plan: PlanItem[] | undefined, toolName: string, input: unknown): PlanItem[] | undefined {
  const fields = isRecord(input) ? input : {};
  if (toolName === "TodoWrite") return Array.isArray(fields.todos) ? fullList(fields.todos) : plan;
  if (toolName === "mcp__ccd_turn__wrap_up") return plan?.map((item) => ({ ...item, status: "completed" }));

  const replaced = fullList(fields.items);
  if (replaced) return replaced;
  if (!plan) return plan;
  let next = plan;
  if (fields.advance === true) next = advance(next);
  if (Array.isArray(fields.done)) next = setStatus(next, fields.done, "completed");
  if (typeof fields.start === "number") next = setStatus(next, [fields.start], "in_progress");
  return next;
}

function fullList(value: unknown): PlanItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((entry): PlanItem[] => {
    if (!isRecord(entry) || typeof entry.content !== "string" || !entry.content.trim()) return [];
    return [{ content: truncate(entry.content.trim()), status: statusOf(entry.status) }];
  });
  return items.length ? items : undefined;
}

// 진행 중인 항목을 끝내고, 그 뒤의 첫 대기 항목(없으면 앞쪽의 첫 대기 항목)을 시작한다.
function advance(plan: PlanItem[]): PlanItem[] {
  const current = plan.findIndex((item) => item.status === "in_progress");
  const after = plan.findIndex((item, i) => i > current && item.status === "pending");
  const next = after >= 0 ? after : plan.findIndex((item) => item.status === "pending");
  return plan.map((item, i) =>
    i === current ? { ...item, status: "completed" } : i === next ? { ...item, status: "in_progress" } : item
  );
}

function setStatus(plan: PlanItem[], numbers: unknown[], status: PlanItemStatus): PlanItem[] {
  const indexes = new Set(numbers.flatMap((n) => (typeof n === "number" ? [n - 1] : [])));
  return plan.map((item, i) => (indexes.has(i) ? { ...item, status } : item));
}

function statusOf(value: unknown): PlanItemStatus {
  return value === "completed" || value === "in_progress" ? value : "pending";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string): string {
  return value.length > CONTENT_MAX ? `${value.slice(0, CONTENT_MAX - 1)}…` : value;
}
