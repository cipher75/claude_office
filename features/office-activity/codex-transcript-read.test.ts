import { appendFileSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { readCodexTranscript } from "./codex-events";

const dir = mkdtempSync(join(tmpdir(), "codex-read-"));
let n = 0;
const fresh = () => join(dir, `rollout-${n++}.jsonl`);

const done = (id: string, status = "completed") =>
  `${JSON.stringify({ type: "event_msg", payload: { type: "item_completed", turn_id: "t", item: { type: "CommandExecution", id, status, command: ["bash", "-lc", `echo ${id}`] } } })}\n`;
const reviewer = (value: string) =>
  `${JSON.stringify({ type: "event_msg", payload: { type: "thread_settings_applied", thread_settings: { approvals_reviewer: value } } })}\n`;

describe("Codex 기록 이어 읽기", () => {
  test("새로 붙은 줄만 더해 지금까지의 결과를 돌려준다", () => {
    const path = fresh();
    writeFileSync(path, reviewer("user") + done("a"));
    expect(readCodexTranscript(path).outcomes.map((o) => o.id)).toEqual(["a"]);

    appendFileSync(path, done("b", "declined") + reviewer("auto_review"));
    const result = readCodexTranscript(path);

    expect(result.outcomes.map((o) => [o.id, o.status])).toEqual([["a", "completed"], ["b", "declined"]]);
    expect(result.reviewer).toBe("auto_review");
  });

  test("미완성 마지막 줄은 끝나기를 기다렸다가 한 번만 읽는다", () => {
    const path = fresh();
    const line = done("a");
    writeFileSync(path, line.slice(0, 20));
    expect(readCodexTranscript(path).outcomes).toEqual([]);

    appendFileSync(path, line.slice(20));
    expect(readCodexTranscript(path).outcomes.map((o) => o.id)).toEqual(["a"]);
    expect(readCodexTranscript(path).outcomes.map((o) => o.id)).toEqual(["a"]);
  });

  test("줄바꿈 사이에서 끊겨 붙은 한글도 깨지지 않는다", () => {
    const path = fresh();
    const line = `${JSON.stringify({ type: "event_msg", payload: { type: "item_completed", item: { type: "CommandExecution", id: "한글", status: "completed" } } })}\n`;
    const bytes = Buffer.from(line);
    const cut = bytes.indexOf(Buffer.from("한")) + 1;
    writeFileSync(path, bytes.subarray(0, cut));
    readCodexTranscript(path);
    appendFileSync(path, bytes.subarray(cut));

    expect(readCodexTranscript(path).outcomes.map((o) => o.id)).toEqual(["한글"]);
  });

  test("파일이 줄거나 다른 파일로 바뀌면 처음부터 다시 읽는다", () => {
    const path = fresh();
    writeFileSync(path, done("a") + done("b"));
    readCodexTranscript(path);

    writeFileSync(path, done("c"));
    expect(readCodexTranscript(path).outcomes.map((o) => o.id)).toEqual(["c"]);

    const other = fresh();
    writeFileSync(other, done("d") + done("e") + done("f"));
    renameSync(other, path);
    expect(readCodexTranscript(path).outcomes.map((o) => o.id)).toEqual(["d", "e", "f"]);
  });

  test("조각조각 붙여 읽은 결과가 한 번에 읽은 결과와 같다", () => {
    const lines = [reviewer("user"), done("a"), done("b", "failed"), reviewer("auto_review"), done("c", "declined")].join("");
    const whole = fresh();
    writeFileSync(whole, lines);
    const pieces = fresh();
    writeFileSync(pieces, "");
    for (let i = 0; i < lines.length; i += 37) {
      appendFileSync(pieces, lines.slice(i, i + 37));
      readCodexTranscript(pieces);
    }

    expect(readCodexTranscript(pieces)).toEqual(readCodexTranscript(whole));
  });
});
