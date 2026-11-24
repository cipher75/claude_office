import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { ingestHookEvent, officeSnapshot } from "./server";

// 실제 기록 파일로, 연결 전에 만든 task 목록이 연결 시점에 칠판에 되살아나는 흐름을 확인한다.
const ids: string[] = [];
afterEach(() => {
  for (const id of ids.splice(0)) ingestHookEvent({ hook_event_name: "SessionEnd", session_id: id });
});

const planCall = (id: string, input: unknown) => JSON.stringify({
  type: "assistant", message: { content: [{ type: "tool_use", id, name: "mcp__ccd_turn__update_plan", input }] },
});

test("연결 전에 만든 task 목록을 연결할 때 기록에서 되살리고, 이어지는 변경분도 반영한다", () => {
  const id = crypto.randomUUID();
  ids.push(id);
  const path = join(mkdtempSync(join(tmpdir(), "office-")), `${id}.jsonl`);
  writeFileSync(path, [
    planCall("p1", { items: [
      { content: "리뷰 읽기", status: "in_progress" }, { content: "고치기", status: "pending" }, { content: "검사", status: "pending" },
    ] }),
    planCall("p2", { advance: true }),
  ].join("\n") + "\n");

  ingestHookEvent({ hook_event_name: "OfficeConnect", session_id: id, transcript_path: path });
  expect(officeSnapshot().sessions[id].plan?.map((item) => item.status)).toEqual(["completed", "in_progress", "pending"]);

  ingestHookEvent({
    hook_event_name: "PostToolUse", session_id: id, transcript_path: path,
    tool_use_id: "p3", tool_name: "mcp__ccd_turn__update_plan", tool_input: { done: [2], start: 3 },
  });
  expect(officeSnapshot().sessions[id].plan?.map((item) => item.status)).toEqual(["completed", "completed", "in_progress"]);
});
