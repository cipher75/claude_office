import { describe, expect, test } from "vitest";

import type { Character, OfficeState, Session } from "../types";
import { redactState } from "./redact";

function character(overrides: Partial<Character>): Character {
  return {
    id: "t1",
    kind: "tool",
    status: "working",
    label: "",
    toolName: "Read",
    toolInput: {},
    since: 1_000,
    ...overrides,
  };
}

function stateWith(...characters: Character[]): OfficeState {
  const session: Session = {
    id: "s1",
    name: "side-project",
    connected: true,
    lit: true,
    doneCount: 3,
    characters,
  };
  return { sessions: { s1: session }, order: ["s1"], instance: "boot-1" };
}

function labelsOf(state: OfficeState): string[] {
  return state.sessions.s1.characters.map((c) => c.label);
}

describe("호스팅으로 보낼 라벨", () => {
  test("파일을 다루는 도구는 도구 이름과 파일 이름만 남기고 폴더는 버린다", () => {
    const redacted = redactState(
      stateWith(
        character({ id: "a", toolName: "Read", label: "Read · PRODUCT.md", toolInput: { file_path: "D:\\work\\private-client\\PRODUCT.md" } }),
        character({ id: "b", toolName: "Edit", toolInput: { file_path: "/home/me/secrets/.env" } })
      )
    );

    expect(labelsOf(redacted)).toEqual(["Read · PRODUCT.md", "Edit · .env"]);
    expect(JSON.stringify(redacted)).not.toContain("private-client");
    expect(JSON.stringify(redacted)).not.toContain("secrets");
  });

  test("명령, URL, 검색어는 도구 이름만 남기고 내용은 버린다", () => {
    const redacted = redactState(
      stateWith(
        character({ id: "a", toolName: "Bash", label: "Bash · curl -H 'Authorization: SECRET_TOKEN'", toolInput: { command: "curl -H 'Authorization: SECRET_TOKEN' https://x.test" } }),
        character({ id: "b", toolName: "WebFetch", toolInput: { url: "https://example.com/?key=SECRET_KEY" } }),
        character({ id: "c", toolName: "Grep", toolInput: { pattern: "password=SECRET_PATTERN" } })
      )
    );

    expect(labelsOf(redacted)).toEqual(["Bash", "WebFetch", "Grep"]);
    expect(JSON.stringify(redacted)).not.toContain("SECRET");
  });

  test("호출 입력은 어느 필드로도 남지 않는다", () => {
    const redacted = redactState(stateWith(character({ toolName: "Bash", toolInput: { command: "echo SECRET_INPUT" } })));

    expect(JSON.stringify(redacted)).not.toContain("SECRET_INPUT");
    expect(redacted.sessions.s1.characters[0].toolInput).toBeNull();
  });

  test("skill과 sub-agent는 이름만 남기고, 이름이 없으면 설명을 쓰지 않는다", () => {
    const redacted = redactState(
      stateWith(
        character({ id: "a", kind: "skill", toolName: "Skill", label: "skill · shadcn", toolInput: { skill: "shadcn", args: "SECRET_ARGS" } }),
        character({ id: "b", kind: "sub", toolName: "Agent", label: "서브에이전트 · Explore", toolInput: { subagent_type: "Explore", prompt: "SECRET_PROMPT" } }),
        character({ id: "c", kind: "sub", toolName: "Agent", label: "서브에이전트 · SECRET_DESCRIPTION", toolInput: { description: "SECRET_DESCRIPTION" } })
      )
    );

    expect(labelsOf(redacted)).toEqual(["skill · shadcn", "서브에이전트 · Explore", "서브에이전트"]);
    expect(JSON.stringify(redacted)).not.toContain("SECRET");
  });

  test("MCP 도구는 서버와 도구 이름으로 보여준다", () => {
    const redacted = redactState(stateWith(character({ toolName: "mcp__Claude_Browser__computer", toolInput: { text: "SECRET_TEXT" } })));

    expect(labelsOf(redacted)).toEqual(["Claude_Browser · computer"]);
  });
});

describe("호스팅으로 보낼 상태", () => {
  test("종료 세션은 순서에서도 빼고, 연결된 대기·생각 중·백그라운드 세션과 로컬 원본은 보존한다", () => {
    const state = stateWith(character({ status: "waiting" }));
    const base = state.sessions.s1;
    state.sessions.ended = { ...base, id: "ended", connected: false, lit: false, characters: [] };
    state.sessions.closed = { ...base, id: "closed", connected: false, closed: true, lit: false, characters: [] };
    state.sessions.idle = { ...base, id: "idle", lit: false, characters: [] };
    state.sessions.thinking = { ...base, id: "thinking", inTurn: true, characters: [] };
    state.sessions.background = { ...base, id: "background", inTurn: false, characters: [character({ kind: "sub", background: true })] };
    state.order = ["ended", "thinking", "s1", "closed", "idle", "background"];
    const original = structuredClone(state);

    const redacted = redactState(state);

    expect(redacted.order).toEqual(["thinking", "s1", "idle", "background"]);
    expect(Object.keys(redacted.sessions).sort()).toEqual([...redacted.order].sort());
    expect(redacted.sessions.s1.characters[0].status).toBe("waiting");
    expect(redacted.sessions.thinking.inTurn).toBe(true);
    expect(redacted.sessions.background.characters[0].background).toBe(true);
    expect(state).toEqual(original);
  });

  test("세션 이름, 불, 완료 건수, 캐릭터의 상태와 종류는 그대로 보낸다", () => {
    const redacted = redactState(stateWith(character({ id: "a", status: "waiting", kind: "tool", toolName: "Bash", toolInput: { command: "ls" } })));

    expect(redacted).toMatchObject({
      instance: "boot-1",
      order: ["s1"],
      sessions: { s1: { name: "side-project", connected: true, lit: true, doneCount: 3 } },
    });
    expect(redacted.sessions.s1.characters[0]).toMatchObject({ id: "a", status: "waiting", kind: "tool", toolName: "Bash" });
  });

  test("원래 상태를 바꾸지 않는다", () => {
    const original = stateWith(character({ toolName: "Bash", label: "Bash · ls -la", toolInput: { command: "ls -la" } }));

    redactState(original);

    expect(original.sessions.s1.characters[0]).toMatchObject({ label: "Bash · ls -la", toolInput: { command: "ls -la" } });
  });
});

describe("호스팅으로 보내지 않는 세션 정보", () => {
  test("task 목록의 문구는 보내지 않는다", () => {
    const state = stateWith();
    state.sessions.s1.plan = [{ content: "private-client 결제 버그 고치기", status: "in_progress" }];
    state.sessions.s1.planCallIds = ["p1"];

    const redacted = redactState(state);

    expect(redacted.sessions.s1).not.toHaveProperty("plan");
    expect(redacted.sessions.s1).not.toHaveProperty("planCallIds");
  });

  test("세션의 전체 경로와 탭에서 내린 세션은 보내지 않는다", () => {
    const state = stateWith();
    state.sessions.s1.cwd = "/home/me/private-client/side-project";
    state.sessions.s1.projectRoot = "/home/me/private-client/side-project";
    state.sessions.s1.project = "side-project";
    state.retired = { s0: { ...state.sessions.s1, id: "s0" } };

    const redacted = redactState(state);

    expect(redacted.sessions.s1).not.toHaveProperty("cwd");
    expect(redacted.sessions.s1).not.toHaveProperty("projectRoot");
    expect(redacted.sessions.s1.project).toBe("side-project");
    expect(redacted.sessions.s1.projectId).toMatch(/^[0-9a-f]{8}$/);
    expect(redacted).not.toHaveProperty("retired");
    expect(state.sessions.s1.cwd).toBe("/home/me/private-client/side-project");
  });
});
