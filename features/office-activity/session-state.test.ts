import { describe, expect, test } from "vitest";

import { applyHookEvent, emptyOfficeState } from "./session-state";
import type { OfficeState } from "./types";

const S = "session-1";

function apply(state: OfficeState, ...payloads: Record<string, unknown>[]) {
  return payloads.reduce<OfficeState>(
    (current, payload, i) => applyHookEvent(current, payload, 1_000 + i),
    state
  );
}

function session(state: OfficeState, id = S) {
  const found = state.sessions[id];
  if (!found) throw new Error(`session ${id} not found`);
  return found;
}

const connect = {
  hook_event_name: "OfficeConnect",
  session_id: S,
  project: "side-project",
};

describe("연결", () => {
  test("연결 신호를 받으면 프로젝트 이름의 세션이 만들어지고 사무실에 불이 켜진다", () => {
    const state = apply(emptyOfficeState(), connect);

    expect(session(state)).toMatchObject({
      id: S,
      name: "side-project",
      connected: true,
      lit: true,
      characters: [],
    });
  });

  test("연결 신호 없이 첫 이벤트가 와도 cwd 폴더 이름으로 세션이 만들어진다", () => {
    const state = apply(emptyOfficeState(), {
      hook_event_name: "UserPromptSubmit",
      session_id: S,
      cwd: "D:\\claude\\side-project",
    });

    expect(session(state)).toMatchObject({ name: "side-project", lit: true });
  });

  test("서버가 붙인 저장소 경로로 프로젝트를 알고, 세션 이름은 연 폴더 이름 그대로 둔다", () => {
    const state = apply(emptyOfficeState(), {
      hook_event_name: "OfficeConnect",
      session_id: S,
      cwd: "/work/shop/.claude/worktrees/fix-cart",
      project_root: "/work/shop",
    });

    expect(session(state)).toMatchObject({ name: "fix-cart", project: "shop", projectRoot: "/work/shop" });
  });
});

describe("수행 중", () => {
  test("tool 호출이 시작되면 하는 일이 라벨인 tool 캐릭터가 생긴다", () => {
    const state = apply(emptyOfficeState(), connect, {
      hook_event_name: "PreToolUse",
      session_id: S,
      tool_use_id: "t1",
      tool_name: "Read",
      tool_input: { file_path: "D:\\claude\\side-project\\PRODUCT.md" },
    });

    expect(session(state).characters).toEqual([
      expect.objectContaining({
        id: "t1",
        kind: "tool",
        status: "working",
        label: "Read · PRODUCT.md",
      }),
    ]);
  });

  test("Bash 명령은 라벨에서 길이를 줄여 보여준다", () => {
    const command = "bun run typecheck && bun run lint && bun run test && bun run build";
    const state = apply(emptyOfficeState(), connect, {
      hook_event_name: "PreToolUse",
      session_id: S,
      tool_use_id: "t1",
      tool_name: "Bash",
      tool_input: { command },
    });

    const [character] = session(state).characters;
    expect(character.label.startsWith("Bash · bun run typecheck")).toBe(true);
    expect(character.label.length).toBeLessThanOrEqual(40);
  });

  test("Agent 호출은 sub-agent, Skill 호출은 skill 캐릭터가 된다", () => {
    const state = apply(
      emptyOfficeState(),
      connect,
      {
        hook_event_name: "PreToolUse",
        session_id: S,
        tool_use_id: "a1",
        tool_name: "Agent",
        tool_input: { subagent_type: "Explore", description: "훅 문서 조사" },
      },
      {
        hook_event_name: "PreToolUse",
        session_id: S,
        tool_use_id: "k1",
        tool_name: "Skill",
        tool_input: { skill: "shadcn" },
      }
    );

    expect(session(state).characters).toEqual([
      expect.objectContaining({ id: "a1", kind: "sub", label: "서브에이전트 · Explore" }),
      expect.objectContaining({ id: "k1", kind: "skill", label: "skill · shadcn" }),
    ]);
  });

  test("호출이 끝나면 캐릭터가 사라지고, 한 번 일이 있었던 세션은 턴이 끝날 때 불이 꺼진다", () => {
    const state = apply(
      emptyOfficeState(),
      connect,
      {
        hook_event_name: "PreToolUse",
        session_id: S,
        tool_use_id: "t1",
        tool_name: "Read",
        tool_input: { file_path: "a.md" },
      },
      { hook_event_name: "PostToolUse", session_id: S, tool_use_id: "t1", tool_name: "Read" }
    );

    expect(session(state)).toMatchObject({ characters: [], doneCount: 1, lit: true });
    const ended = applyHookEvent(state, { hook_event_name: "Stop", session_id: S }, 2_000);
    expect(session(ended).lit).toBe(false);
  });

  test("불이 꺼진 뒤 새 호출이 시작되면 다시 켜진다", () => {
    const state = apply(
      emptyOfficeState(),
      connect,
      { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "t1", tool_name: "Read", tool_input: {} },
      { hook_event_name: "PostToolUse", session_id: S, tool_use_id: "t1", tool_name: "Read" },
      { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "t2", tool_name: "Read", tool_input: {} }
    );

    expect(session(state)).toMatchObject({ lit: true, doneCount: 1 });
    expect(session(state).characters).toHaveLength(1);
  });

  test("실패로 끝난 호출도 캐릭터가 나간다", () => {
    const state = apply(
      emptyOfficeState(),
      connect,
      { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "t1", tool_name: "Bash", tool_input: { command: "false" } },
      { hook_event_name: "PostToolUseFailure", session_id: S, tool_use_id: "t1", tool_name: "Bash", error: "exit 1" }
    );

    expect(session(state).characters).toEqual([]);
  });
});

describe("백그라운드로 시작한 sub-agent", () => {
  const launch = {
    hook_event_name: "PreToolUse",
    session_id: S,
    tool_use_id: "a1",
    tool_name: "Agent",
    tool_input: { subagent_type: "Explore" },
  };
  const launched = {
    hook_event_name: "PostToolUse",
    session_id: S,
    tool_use_id: "a1",
    tool_name: "Agent",
    tool_response: { isAsync: true, status: "async_launched", agentId: "agent-1" },
  };

  test("시작만 알리는 응답이 와도 sub-agent 캐릭터는 턴이 끝날 때까지 일한다", () => {
    const state = apply(emptyOfficeState(), connect, launch, launched);

    expect(session(state).characters).toEqual([expect.objectContaining({ id: "a1", status: "working" })]);
    expect(session(state).doneCount).toBe(0);
  });

  test("턴이 끝나도 백그라운드 sub-agent 캐릭터는 계속 일한다", () => {
    const state = apply(emptyOfficeState(), connect, launch, launched, { hook_event_name: "Stop", session_id: S });

    expect(session(state).characters).toEqual([expect.objectContaining({ id: "a1", status: "working" })]);
  });

  test("sub-agent가 끝났다는 신호가 오면 그 캐릭터가 나간다", () => {
    const state = apply(emptyOfficeState(), connect, launch, launched, {
      hook_event_name: "TranscriptTaskFinished",
      session_id: S,
      tool_use_id: "a1",
    });

    expect(session(state)).toMatchObject({ characters: [], doneCount: 1 });
  });

  test("다른 호출의 끝 신호는 이 sub-agent 캐릭터에 영향을 주지 않는다", () => {
    const state = apply(emptyOfficeState(), connect, launch, launched, {
      hook_event_name: "TranscriptTaskFinished",
      session_id: S,
      tool_use_id: "other",
    });

    expect(session(state).characters).toHaveLength(1);
  });

  test("세션이 끝나면 남은 sub-agent 캐릭터도 나간다", () => {
    const state = apply(emptyOfficeState(), connect, launch, launched, { hook_event_name: "SessionEnd", session_id: S });

    expect(session(state).characters).toEqual([]);
  });

  test("바로 끝나는 일반 Agent 호출은 응답이 오면 나간다", () => {
    const state = apply(emptyOfficeState(), connect, launch, {
      ...launched,
      tool_response: { status: "completed", content: [] },
    });

    expect(session(state).characters).toEqual([]);
  });
});

describe("슬래시로 직접 호출한 skill", () => {
  const expansion = {
    hook_event_name: "UserPromptExpansion",
    session_id: S,
    prompt_id: "p1",
    expansion_type: "slash_command",
    command_name: "shadcn",
    prompt: "/shadcn",
  };

  test("슬래시 명령으로 skill을 호출하면 skill 캐릭터가 생기고 턴이 끝나면 나간다", () => {
    const running = apply(emptyOfficeState(), connect, expansion);
    expect(session(running).characters).toEqual([
      expect.objectContaining({ kind: "skill", status: "working", label: "skill · shadcn" }),
    ]);

    const stopped = apply(running, { hook_event_name: "Stop", session_id: S });
    expect(session(stopped).characters).toEqual([]);
  });

  test("연결용 /office 호출은 캐릭터로 만들지 않는다", () => {
    const state = apply(emptyOfficeState(), connect, { ...expansion, command_name: "office", prompt: "/office" });

    expect(session(state).characters).toEqual([]);
  });
});

describe("MCP tool 이름", () => {
  test("mcp__서버__도구 이름은 서버와 도구로 나눠 읽기 쉽게 보여준다", () => {
    const state = apply(emptyOfficeState(), connect, {
      hook_event_name: "PreToolUse",
      session_id: S,
      tool_use_id: "m1",
      tool_name: "mcp__Claude_Browser__computer",
      tool_input: { action: "screenshot" },
    });

    expect(session(state).characters[0]).toMatchObject({ kind: "tool", label: "Claude_Browser · computer" });
  });
});

// 허용과 거절은 추정하지 않는다. 허용은 회의실에 있던 호출이 실행되었다는 신호(Post hook이나
// transcript의 Post hook 기록)로, 거절은 transcript가 실행되지 않았다고 알려 준 호출(TranscriptNotExecuted)이나
// PermissionDenied hook으로 정한다.
describe("허용과 거절", () => {
  const bash = { command: "git push" };
  const waiting = (...more: Record<string, unknown>[]) =>
    apply(
      emptyOfficeState(),
      connect,
      { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "t1", tool_name: "Read", tool_input: { file_path: "a.md" } },
      { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "t2", tool_name: "Bash", tool_input: bash },
      { hook_event_name: "PermissionRequest", session_id: S, tool_name: "Bash", tool_input: bash },
      ...more
    );
  const statusOf = (state: OfficeState) => session(state).characters.map((c) => [c.id, c.status]);
  const post = (id: string) => ({ hook_event_name: "PostToolUse", session_id: S, tool_use_id: id });
  const result = (id: string) => ({ hook_event_name: "TranscriptNotExecuted", session_id: S, tool_use_id: id });
  const rejected = (id: string) => ({ ...result(id), rejected: true });

  test("허용 요청이 오면 입력이 같은 호출의 캐릭터만 허용 대기가 된다", () => {
    expect(statusOf(waiting())).toEqual([["t1", "working"], ["t2", "waiting"]]);
  });

  test("허용 대기였던 호출의 Post hook이 오면 허용된 것이므로 approved가 된다", () => {
    const state = waiting(post("t2"));

    expect(statusOf(state)).toEqual([["t1", "working"], ["t2", "approved"]]);
    expect(session(state).doneCount).toBe(1);
  });

  test("허용 대기였던 호출이 실패로 끝나도 실행은 된 것이므로 approved가 된다", () => {
    const state = waiting({ hook_event_name: "PostToolUseFailure", session_id: S, tool_use_id: "t2", error: "exit 1" });

    expect(statusOf(state)).toEqual([["t1", "working"], ["t2", "approved"]]);
  });

  test("서버가 Post hook을 놓쳐도 transcript에 실행 기록이 있으면 approved가 된다", () => {
    const state = waiting({ hook_event_name: "TranscriptExecuted", session_id: S, tool_use_id: "t2", tool_response: { isAsync: false } });

    expect(statusOf(state)).toEqual([["t1", "working"], ["t2", "approved"]]);
  });

  test("Post hook과 transcript 실행 기록이 둘 다 와도 한 번만 센다", () => {
    const executed = { hook_event_name: "TranscriptExecuted", session_id: S, tool_use_id: "t2", tool_response: { isAsync: false } };
    const state = waiting(post("t2"), executed);

    expect(statusOf(state)).toEqual([["t1", "working"], ["t2", "approved"]]);
    expect(session(state).doneCount).toBe(1);
  });

  // Claude Code는 호출을 시작하며 PreToolUse를 보낸 직후 그 호출의 허용을 묻는다.
  const twins = [
    connect,
    { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "p1", tool_name: "Bash", tool_input: bash },
    { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "p2", tool_name: "Bash", tool_input: bash },
    { hook_event_name: "PermissionRequest", session_id: S, tool_name: "Bash", tool_input: bash },
  ];

  test("입력이 같은 호출이 여럿이면 가장 최근에 시작한 호출이 허용 대기가 된다", () => {
    expect(statusOf(apply(emptyOfficeState(), ...twins))).toEqual([["p1", "working"], ["p2", "waiting"]]);
  });

  test("짝이 틀려 회의실 밖에 있던 같은 입력의 호출이 실행되면, 그 호출을 허용된 것으로 바로잡는다", () => {
    const state = apply(emptyOfficeState(), ...twins, post("p1"));

    expect(statusOf(state)).toEqual([["p1", "approved"], ["p2", "working"]]);
    expect(session(state).characters.find((c) => c.id === "p2")?.waitingAt).toBeUndefined();
  });

  test("입력이 다른 호출이 실행된 것은 회의실의 호출과 상관없다", () => {
    const state = waiting(post("t1"));

    expect(statusOf(state)).toEqual([["t2", "waiting"]]);
  });

  test("입력 표현이 달라 같은 입력을 못 찾아도 같은 도구의 가장 최근 호출이 허용 대기가 된다", () => {
    const state = apply(
      emptyOfficeState(),
      connect,
      { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "b1", tool_name: "Bash", tool_input: { command: "ls" } },
      { hook_event_name: "PermissionRequest", session_id: S, tool_name: "Bash", tool_input: { command: "ls", extra: 1 } }
    );

    expect(statusOf(state)).toEqual([["b1", "waiting"]]);
  });

  test("실행되지 않은 결과에 거절의 증거가 있으면 그 캐릭터만 denied가 된다", () => {
    const state = waiting(rejected("t2"));

    expect(statusOf(state)).toEqual([["t1", "working"], ["t2", "denied"]]);
    expect(session(state).doneCount).toBe(1);
  });

  test("이미 Post hook으로 끝난 호출은 나중 신호가 아무것도 바꾸지 않는다", () => {
    const state = waiting(post("t2"), result("t2"), post("t1"), result("t1"));

    expect(statusOf(state)).toEqual([["t2", "approved"]]);
    expect(session(state).doneCount).toBe(2);
  });

  test("거절의 증거 없이 실행되지 않은 호출(만료, 새 메시지로 닫힘, 중단 등)은 cancelled가 된다", () => {
    const state = waiting(result("t2"));

    expect(statusOf(state)).toEqual([["t1", "working"], ["t2", "cancelled"]]);
    expect(session(state).doneCount).toBe(1);
  });

  test("허용 창 없이 권한 규칙으로 막힌 호출은 사용자의 거절이 아니므로 cancelled가 된다", () => {
    const state = waiting(result("t1"));

    expect(statusOf(state)).toEqual([["t1", "cancelled"], ["t2", "waiting"]]);
  });

  test("transcript를 믿을 수 없게 된 세션은 실행되지 않았다는 판단을 쓰지 않는다", () => {
    const state = waiting({ hook_event_name: "TranscriptUnreliable", session_id: S, tool_use_id: "x" }, rejected("t2"));

    expect(statusOf(state)).toEqual([["t1", "working"], ["t2", "waiting"]]);
    expect(session(state).transcriptUnreliable).toBe(true);
  });

  test("auto 모드 분류기의 거절 hook은 tool_use_id가 같은 캐릭터만 denied로 바꾼다", () => {
    const state = waiting(
      { hook_event_name: "PermissionDenied", session_id: S, tool_use_id: "other", tool_name: "Bash" },
      { hook_event_name: "PermissionDenied", session_id: S, tool_use_id: "t2", tool_name: "Bash" }
    );

    expect(statusOf(state)).toEqual([["t1", "working"], ["t2", "denied"]]);
  });

  test("새 프롬프트가 오거나 오래 기다려도 거절로 보지 않는다", () => {
    let state = waiting({ hook_event_name: "UserPromptSubmit", session_id: S, prompt: "다른 걸 해줘" });
    state = applyHookEvent(
      state,
      { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "t3", tool_name: "Read", tool_input: {} },
      600_000
    );

    expect(statusOf(state)).toEqual([["t1", "working"], ["t2", "waiting"], ["t3", "working"]]);
  });

  test("백그라운드로 도는 sub-agent는 시작 결과가 기록되어도 거절로 보지 않는다", () => {
    const state = apply(
      emptyOfficeState(),
      connect,
      { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "a1", tool_name: "Agent", tool_input: {} },
      { hook_event_name: "PostToolUse", session_id: S, tool_use_id: "a1", tool_response: { isAsync: true } },
      result("a1")
    );

    expect(statusOf(state)).toEqual([["a1", "working"]]);
  });

  test("서버가 Post hook을 놓친 백그라운드 sub-agent도 transcript의 실행 기록으로 계속 일한다", () => {
    const state = apply(
      emptyOfficeState(),
      connect,
      { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "a1", tool_name: "Agent", tool_input: {} },
      { hook_event_name: "TranscriptExecuted", session_id: S, tool_use_id: "a1", tool_response: { isAsync: true } },
      { hook_event_name: "Stop", session_id: S }
    );

    expect(session(state).characters).toEqual([expect.objectContaining({ id: "a1", status: "working", background: true })]);
  });

  test("transcript를 읽지 못해도 턴이 끝나면 허용 대기는 거절의 증거가 없으므로 cancelled가 되고, 일하던 호출은 끝난다", () => {
    const state = waiting({ hook_event_name: "Stop", session_id: S });

    expect(statusOf(state)).toEqual([["t2", "cancelled"]]);
    expect(session(state).doneCount).toBe(2);
  });

  test("허용되거나 거절된 캐릭터는 끝난 일로 세고, 퇴근 장면 시간이 지나면 정리된다", () => {
    let state = waiting(post("t1"), result("t2"));
    expect(session(state).doneCount).toBe(2);
    expect(session(state).characters.some((c) => c.status === "working" || c.status === "waiting")).toBe(false);

    state = applyHookEvent(state, { hook_event_name: "Notification", session_id: S }, 60_000);
    expect(session(state).characters).toEqual([]);
  });

  test("세션이 끝나면 허용 대기는 허용 여부를 모르므로 approved가 아니라 그냥 나간다", () => {
    const state = waiting({ hook_event_name: "SessionEnd", session_id: S });

    expect(session(state).characters).toEqual([]);
    expect(session(state).doneCount).toBe(2);
  });
});

// 허용 창이 떠 있는데 화면에 ?가 없는 것이 가장 나쁜 실패다. hook을 놓쳐도 ?는 만든다.
describe("hook을 놓쳐도 허용 대기는 보인다", () => {
  const push = { command: "git push" };
  const permission = { hook_event_name: "PermissionRequest", session_id: S, tool_name: "Bash", tool_input: push };
  const statusOf = (state: OfficeState) => session(state).characters.map((c) => [c.id, c.status, Boolean(c.orphan)]);

  test("PreToolUse를 놓쳐 짝지을 캐릭터가 없어도 허용 요청만으로 ? 캐릭터를 만든다", () => {
    const state = apply(emptyOfficeState(), connect, permission);
    const [character] = session(state).characters;

    expect(character).toMatchObject({ status: "waiting", orphan: true, toolName: "Bash", label: "Bash · git push" });
    expect(session(state).lit).toBe(true);
  });

  test("그 호출의 Post hook이 오면 진짜 id를 이어 붙이고 허용된 것으로 끝낸다", () => {
    const state = apply(emptyOfficeState(), connect, permission, {
      hook_event_name: "PostToolUse",
      session_id: S,
      tool_use_id: "real",
      tool_name: "Bash",
      tool_input: push,
    });

    expect(statusOf(state)).toEqual([["real", "approved", false]]);
  });

  test("transcript가 도구와 입력을 붙여 거절을 알려 주면 그 ? 캐릭터가 거절됨이 된다", () => {
    const state = apply(emptyOfficeState(), connect, permission, {
      hook_event_name: "TranscriptNotExecuted",
      session_id: S,
      tool_use_id: "real",
      tool_name: "Bash",
      tool_input: push,
      rejected: true,
    });

    expect(statusOf(state)).toEqual([["real", "denied", false]]);
  });

  test("늦게 도착한 PreToolUse는 ? 캐릭터에 이어 붙고 캐릭터를 하나 더 만들지 않는다", () => {
    const state = apply(emptyOfficeState(), connect, permission, {
      hook_event_name: "PreToolUse",
      session_id: S,
      tool_use_id: "real",
      tool_name: "Bash",
      tool_input: push,
    });

    expect(statusOf(state)).toEqual([["real", "waiting", false]]);
  });

  test("이어 붙일 신호가 끝내 없으면 턴이 끝날 때 중단됨으로 나간다", () => {
    const state = apply(emptyOfficeState(), connect, permission, { hook_event_name: "Stop", session_id: S });

    expect(statusOf(state)).toEqual([[expect.stringMatching(/^permission-/), "cancelled", true]]);
  });
});

// sub-agent 안의 호출은 PreToolUse가 오지 않고, 허용 요청과 끝 신호만 프로젝트 설정의 hook으로 온다.
// 예전 /office 스킬 hook과 프로젝트 설정 hook이 함께 걸린 세션에서는 같은 허용 요청이 20ms 안팎으로 두 번 온다.
describe("같은 허용 요청이 여러 번 들어올 때", () => {
  const push = { command: "git push" };
  const pre = { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "t1", tool_name: "Bash", tool_input: push };
  const permission = { hook_event_name: "PermissionRequest", session_id: S, tool_name: "Bash", tool_input: push };
  const statusOf = (state: OfficeState) => session(state).characters.map((c) => c.status);

  test("곧바로 다시 온 같은 허용 요청은 ?를 하나 더 만들지 않는다", () => {
    expect(statusOf(apply(emptyOfficeState(), connect, pre, permission, permission))).toEqual(["waiting"]);
  });

  test("PreToolUse를 놓친 호출이나 sub-agent 호출도 ?는 하나만 생긴다", () => {
    const fromAgent = { ...permission, agent_id: "agent-1" };
    expect(statusOf(apply(emptyOfficeState(), connect, permission, permission))).toEqual(["waiting"]);
    expect(statusOf(apply(emptyOfficeState(), connect, fromAgent, fromAgent))).toEqual(["waiting"]);
  });

  test("시간이 지나 다시 온 같은 입력의 허용 요청은 새 요청으로 본다", () => {
    let state = apply(emptyOfficeState(), connect, permission);
    state = applyHookEvent(state, permission, 1_000 + 5_000);

    expect(statusOf(state)).toEqual(["waiting", "waiting"]);
  });
});

describe("/office close", () => {
  const disconnect = { hook_event_name: "OfficeDisconnect", session_id: S };
  const pre = { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "t1", tool_name: "Read", tool_input: {} };

  test("연결을 끊으면 남은 캐릭터가 나가고 세션은 종료로 보인다", () => {
    const state = apply(emptyOfficeState(), connect, pre, disconnect);

    expect(session(state)).toMatchObject({ connected: false, closed: true, lit: false, characters: [] });
  });

  test("끊은 뒤 오는 hook 이벤트는 반영하지 않는다", () => {
    const closed = apply(emptyOfficeState(), connect, disconnect);
    const after = apply(closed, pre, { hook_event_name: "UserPromptSubmit", session_id: S });

    expect(after).toBe(closed);
  });

  test("다시 /office로 연결하면 이벤트를 다시 받는다", () => {
    const state = apply(emptyOfficeState(), connect, disconnect, connect, pre);

    expect(session(state)).toMatchObject({ connected: true, closed: false });
    expect(session(state).characters.map((c) => c.id)).toEqual(["t1"]);
  });

  test("사용자가 Esc로 중단하면 Stop 없이도 턴이 끝나 일하던 캐릭터가 나가고 불이 꺼진다", () => {
    const state = apply(
      emptyOfficeState(),
      connect,
      { hook_event_name: "UserPromptSubmit", session_id: S },
      pre,
      { hook_event_name: "TranscriptInterrupted", session_id: S, interrupted_at: 1_003 }
    );

    expect(session(state)).toMatchObject({ inTurn: false, lit: false, characters: [] });
  });

  test("도구 없이 답만 하고 턴을 마치면 불이 꺼지고, 연결만 한 세션은 켜 둔다", () => {
    const connected = apply(emptyOfficeState(), connect);
    expect(session(connected)).toMatchObject({ lit: true });

    const answered = apply(connected, { hook_event_name: "UserPromptSubmit", session_id: S }, { hook_event_name: "Stop", session_id: S });
    expect(session(answered)).toMatchObject({ inTurn: false, doneCount: 0, lit: false });
  });

  test("`!` 명령 뒤처럼 프롬프트 없이 Claude가 답을 쓰기 시작하면 턴이 진행 중이 된다", () => {
    const stop = { hook_event_name: "Stop", session_id: S };
    const request = (at: number) => ({ hook_event_name: "TranscriptModelRequest", session_id: S, requested_at: at });
    // apply는 이벤트마다 1_000, 1_001, … 을 지금 시각으로 쓴다. Stop은 1_001에 끝난다.
    const ended = apply(emptyOfficeState(), connect, stop);
    expect(session(ended)).toMatchObject({ inTurn: false, lit: true });

    expect(session(apply(ended, request(5_000)))).toMatchObject({ inTurn: true, lit: true });
    // Stop보다 먼저 시작한 호출 기록을 늦게 읽은 것은 지난 턴의 것이다.
    expect(session(apply(ended, request(900)))).toMatchObject({ inTurn: false });
  });

  test("연결하지 않은 세션의 transcript에서 읽은 이벤트는 세션을 만들지 않는다", () => {
    const read = (name: string) => ({ hook_event_name: name, session_id: S, tool_use_id: "t1", tool_name: "Bash" });
    const state = apply(
      emptyOfficeState(),
      read("TranscriptExecuted"),
      read("TranscriptNotExecuted"),
      read("TranscriptUnreliable"),
      read("TranscriptTaskFinished"),
      read("TranscriptInterrupted"),
      read("TranscriptModelRequest")
    );

    expect(state.sessions[S]).toBeUndefined();
  });

  test("사무실이 모르는 세션의 끊기 신호는 세션을 만들지 않는다", () => {
    expect(apply(emptyOfficeState(), disconnect).sessions[S]).toBeUndefined();
  });
});

describe("늦게 읽은 중단 기록", () => {
  const event = (state: OfficeState, name: string, now: number, extra: Record<string, unknown> = {}) =>
    applyHookEvent(state, { hook_event_name: name, session_id: S, ...extra }, now);
  const call = { tool_use_id: "new-call", tool_name: "Read", tool_input: { file_path: "PRODUCT.md" } };
  const connected = () => applyHookEvent(emptyOfficeState(), connect, 1_000);

  test("이전 중단을 늦게 읽어도 새 프롬프트의 턴을 끝내지 않는다", () => {
    const started = event(connected(), "UserPromptSubmit", 2_000);
    const state = event(started, "TranscriptInterrupted", 5_000, { interrupted_at: 1_500 });

    expect(session(state)).toMatchObject({ inTurn: true, lit: true });
  });

  test("새 도구 호출을 봤으면 프롬프트 hook을 놓쳐도 이전 중단으로 정리하지 않는다", () => {
    const started = event(connected(), "PreToolUse", 2_000, call);
    const state = event(started, "TranscriptInterrupted", 5_000, { interrupted_at: 1_500 });

    expect(session(state)).toMatchObject({ inTurn: true, lit: true, doneCount: 0 });
    expect(session(state).characters).toEqual([expect.objectContaining({ id: "new-call", status: "working" })]);
  });

  test("새 허용 대기도 이전 턴의 중단으로 지우지 않는다", () => {
    const started = event(connected(), "PreToolUse", 2_000, call);
    const waiting = event(started, "PermissionRequest", 2_100, call);
    const state = event(waiting, "TranscriptInterrupted", 5_000, { interrupted_at: 1_500 });

    expect(session(state).characters).toEqual([expect.objectContaining({ id: "new-call", status: "waiting" })]);
    expect(session(state)).toMatchObject({ inTurn: true, doneCount: 0 });
  });

  test("같이 읽은 모델 호출이 중단보다 나중이면 프롬프트 없이 시작한 새 턴을 유지한다", () => {
    const ended = event(connected(), "Stop", 1_200);
    const started = event(ended, "TranscriptModelRequest", 5_000, { requested_at: 2_000 });
    const state = event(started, "TranscriptInterrupted", 5_000, { interrupted_at: 1_500 });

    expect(session(state)).toMatchObject({ inTurn: true, lit: true, turnEndedAt: 1_200 });
  });

  test("PreToolUse를 놓쳐 새 허용 요청만 받아도 이전 중단으로 대기를 지우지 않는다", () => {
    const waiting = event(connected(), "PermissionRequest", 2_000, call);
    const state = event(waiting, "TranscriptInterrupted", 5_000, { interrupted_at: 1_500 });

    expect(session(state).characters).toEqual([expect.objectContaining({ status: "waiting", orphan: true })]);
    expect(session(state)).toMatchObject({ lit: true, doneCount: 0 });
  });

  test("늦게 읽은 옛 모델 호출은 새 프롬프트로 확인한 진행 시각을 뒤로 돌리지 않는다", () => {
    const started = event(connected(), "UserPromptSubmit", 3_000);
    const oldRequest = event(started, "TranscriptModelRequest", 5_000, { requested_at: 1_200 });
    const state = event(oldRequest, "TranscriptInterrupted", 5_000, { interrupted_at: 2_000 });

    expect(session(state).inTurn).toBe(true);
  });

  test("현재 턴의 중단은 정리하고, 읽은 시각 대신 실제 중단 시각을 남긴다", () => {
    const started = event(connected(), "PreToolUse", 2_000, call);
    const ended = event(started, "TranscriptInterrupted", 5_000, { interrupted_at: 2_100 });

    expect(session(ended)).toMatchObject({ inTurn: false, lit: false, characters: [], doneCount: 1, turnEndedAt: 2_100 });
    const next = event(ended, "TranscriptModelRequest", 5_100, { requested_at: 3_000 });
    expect(session(next).inTurn).toBe(true);
  });

  test("같은 밀리초에 중단한 현재 턴도 끝낼 수 있다", () => {
    const started = event(connected(), "PreToolUse", 2_000, call);
    const state = event(started, "TranscriptInterrupted", 5_000, { interrupted_at: 2_000 });

    expect(session(state)).toMatchObject({ inTurn: false, characters: [], turnEndedAt: 2_000 });
  });

  test("이미 종료한 턴의 중단 기록은 종료 시각을 다시 쓰지 않는다", () => {
    const ended = event(connected(), "Stop", 2_000);
    const state = event(ended, "TranscriptInterrupted", 5_000, { interrupted_at: 1_500 });

    expect(session(state)).toMatchObject({ inTurn: false, turnEndedAt: 2_000 });
  });

  test.each([undefined, "unknown", NaN, Infinity])("시각을 알 수 없는 중단(%s)은 현재 호출을 지우지 않는다", (at) => {
    const started = event(connected(), "PreToolUse", 2_000, call);
    const state = event(started, "TranscriptInterrupted", 5_000, { interrupted_at: at });

    expect(session(state).characters).toHaveLength(1);
    expect(session(state).inTurn).toBe(true);
  });
});

describe("sub-agent 안의 허용 대기", () => {
  const push = { command: "git push" };
  const fromAgent = (name: string, more: Record<string, unknown> = {}) => ({
    hook_event_name: name,
    session_id: S,
    agent_id: "agent-1",
    tool_name: "Bash",
    tool_input: push,
    ...more,
  });
  const mainBash = { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "main", tool_name: "Bash", tool_input: push };
  const statusOf = (state: OfficeState) => session(state).characters.map((c) => [c.id, c.status]);

  test("본 세션에 같은 도구의 호출이 있어도 짝짓지 않고 sub-agent의 ? 캐릭터를 따로 만든다", () => {
    const state = apply(emptyOfficeState(), connect, mainBash, fromAgent("PermissionRequest"));

    expect(statusOf(state)).toEqual([["main", "working"], [expect.stringMatching(/^permission-/), "waiting"]]);
    expect(session(state).characters[1]).toMatchObject({ agentId: "agent-1", label: "Bash · git push" });
  });

  test("그 sub-agent의 Post hook이 오면 허용된 것으로 끝낸다", () => {
    const state = apply(emptyOfficeState(), connect, fromAgent("PermissionRequest"), fromAgent("PostToolUse", { tool_use_id: "a1" }));

    expect(statusOf(state)).toEqual([["a1", "approved"]]);
  });

  test.each(["PostToolUse", "PostToolUseFailure", "TranscriptExecuted"])(
    "본 세션의 같은 입력 호출이 %s로 끝나도 sub-agent의 허용 대기는 그대로 남는다",
    (name) => {
      const state = apply(
        emptyOfficeState(), connect, mainBash, fromAgent("PermissionRequest"),
        { ...mainBash, hook_event_name: name }
      );

      expect(session(state).characters).toEqual([
        expect.objectContaining({ agentId: "agent-1", status: "waiting", orphan: true }),
      ]);
      expect(session(state).doneCount).toBe(1);
    }
  );

  test("다른 sub-agent의 같은 입력 호출이 끝나도 허용 대기는 서로 영향을 주지 않는다", () => {
    const state = apply(
      emptyOfficeState(), connect, fromAgent("PermissionRequest"),
      fromAgent("PreToolUse", { agent_id: "agent-2", tool_use_id: "other" }),
      fromAgent("PostToolUse", { agent_id: "agent-2", tool_use_id: "other" })
    );

    expect(session(state).characters).toEqual([
      expect.objectContaining({ agentId: "agent-1", status: "waiting", orphan: true }),
    ]);
    expect(session(state).doneCount).toBe(1);
  });

  test("본 세션의 허용 요청은 sub-agent의 같은 입력 호출과 짝짓지 않는다", () => {
    const state = apply(
      emptyOfficeState(), connect,
      fromAgent("PreToolUse", { tool_use_id: "child" }),
      { hook_event_name: "PermissionRequest", session_id: S, tool_name: "Bash", tool_input: push }
    );

    expect(session(state).characters).toEqual([
      expect.objectContaining({ id: "child", agentId: "agent-1", status: "working" }),
      expect.objectContaining({ status: "waiting", orphan: true }),
    ]);
    expect(session(state).characters[1].agentId).toBeUndefined();
  });

  // agent-1을 백그라운드로 시작한다. 시작 응답의 agentId가 그 안의 호출이 가진 agent_id와 같다.
  const bgLaunch = [
    { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "bg", tool_name: "Agent", tool_input: { subagent_type: "Explore" } },
    {
      hook_event_name: "PostToolUse", session_id: S, tool_use_id: "bg", tool_name: "Agent",
      tool_response: { isAsync: true, status: "async_launched", agentId: "agent-1" },
    },
  ];
  const bgFinished = { hook_event_name: "TranscriptTaskFinished", session_id: S, tool_use_id: "bg" };
  const waitingIds = (state: OfficeState) =>
    session(state).characters.filter((c) => c.status === "waiting").map((c) => c.agentId ?? "main");

  test.each(["Stop", "TranscriptInterrupted"])(
    "포그라운드 sub-agent의 허용 대기는 본 세션이 %s로 끝날 때 함께 중단됨으로 정리한다",
    (name) => {
      const state = apply(
        emptyOfficeState(), connect, mainBash,
        { hook_event_name: "PermissionRequest", session_id: S, tool_name: "Bash", tool_input: push },
        fromAgent("PermissionRequest"),
        { hook_event_name: name, session_id: S, interrupted_at: 1_004 }
      );

      expect(statusOf(state)).toEqual([["main", "cancelled"], [expect.stringMatching(/^permission-/), "cancelled"]]);
      expect(session(state)).toMatchObject({ inTurn: false, doneCount: 2 });
    }
  );

  test.each(["Stop", "TranscriptInterrupted"])(
    "일하는 백그라운드 sub-agent의 허용 대기는 본 세션이 %s로 끝나도 남는다",
    (name) => {
      const state = apply(
        emptyOfficeState(), connect, ...bgLaunch, mainBash,
        { hook_event_name: "PermissionRequest", session_id: S, tool_name: "Bash", tool_input: push },
        fromAgent("PermissionRequest"),
        { hook_event_name: name, session_id: S, interrupted_at: 1_006 }
      );

      expect(waitingIds(state)).toEqual(["agent-1"]);
      expect(session(state)).toMatchObject({ inTurn: false, lit: true });
    }
  );

  test("다른 sub-agent의 허용 대기는 백그라운드 sub-agent가 일해도 턴 종료에 정리한다", () => {
    const state = apply(
      emptyOfficeState(), connect, ...bgLaunch,
      fromAgent("PermissionRequest", { agent_id: "agent-2" }),
      { hook_event_name: "Stop", session_id: S }
    );

    expect(waitingIds(state)).toEqual([]);
  });

  test("백그라운드 sub-agent의 PreToolUse가 늦게 와도 턴 종료로 허용 대기를 정리하지 않는다", () => {
    const state = apply(
      emptyOfficeState(), connect, ...bgLaunch, fromAgent("PermissionRequest"),
      fromAgent("PreToolUse", { tool_use_id: "child" }),
      { hook_event_name: "Stop", session_id: S }
    );

    expect(session(state).characters).toEqual([
      expect.objectContaining({ id: "bg", status: "working", background: true }),
      expect.objectContaining({ id: "child", agentId: "agent-1", status: "waiting", orphan: false }),
    ]);
  });

  test("턴 종료는 백그라운드 sub-agent의 진행 중 호출을 남기고, 포그라운드 sub-agent의 호출은 끝낸다", () => {
    const state = apply(
      emptyOfficeState(), connect, ...bgLaunch,
      fromAgent("PreToolUse", { tool_use_id: "child" }),
      fromAgent("PreToolUse", { tool_use_id: "fg", agent_id: "agent-2" }),
      { hook_event_name: "Stop", session_id: S }
    );

    expect(session(state).characters.map((c) => c.id)).toEqual(["bg", "child"]);
  });

  test.each([
    ["PostToolUse", "approved"],
    ["PostToolUseFailure", "approved"],
    ["PermissionDenied", "denied"],
  ])("본 세션 턴 종료 뒤에도 백그라운드 sub-agent의 %s로 허용 대기를 해제한다", (name, status) => {
    const state = apply(
      emptyOfficeState(), connect, ...bgLaunch, fromAgent("PermissionRequest"),
      { hook_event_name: "Stop", session_id: S },
      fromAgent(name, { tool_use_id: "child" })
    );

    expect(statusOf(state)).toEqual([["bg", "working"], ["child", status]]);
  });

  test("Post hook을 놓쳐 transcript로 백그라운드 시작을 알아도 그 sub-agent의 허용 대기는 턴 종료에 남는다", () => {
    const state = apply(
      emptyOfficeState(), connect, bgLaunch[0],
      {
        hook_event_name: "TranscriptExecuted", session_id: S, tool_use_id: "bg", tool_name: "Agent",
        tool_response: { isAsync: true, agentId: "agent-1" },
      },
      fromAgent("PermissionRequest"),
      { hook_event_name: "Stop", session_id: S }
    );

    expect(waitingIds(state)).toEqual(["agent-1"]);
  });

  test("백그라운드 sub-agent가 끝나면 그 안에 남은 허용 대기도 중단됨으로 정리한다", () => {
    const state = apply(
      emptyOfficeState(), connect, ...bgLaunch, fromAgent("PermissionRequest"),
      { hook_event_name: "Stop", session_id: S }, bgFinished
    );

    expect(statusOf(state)).toEqual([[expect.stringMatching(/^permission-/), "cancelled"]]);
  });

  test("백그라운드 sub-agent가 끝나도 새 턴에서 다른 sub-agent가 기다리는 허용은 지우지 않는다", () => {
    const state = apply(
      emptyOfficeState(), connect, ...bgLaunch,
      { hook_event_name: "Stop", session_id: S },
      { hook_event_name: "UserPromptSubmit", session_id: S },
      fromAgent("PermissionRequest", { agent_id: "agent-2" }),
      bgFinished
    );

    expect(waitingIds(state)).toEqual(["agent-2"]);
  });

  test.each(["SessionEnd", "OfficeDisconnect"])("%s는 sub-agent의 허용 대기도 함께 내보낸다", (name) => {
    const state = apply(
      emptyOfficeState(), connect, fromAgent("PermissionRequest"),
      { hook_event_name: name, session_id: S }
    );

    expect(session(state)).toMatchObject({ connected: false, lit: false, characters: [], doneCount: 1 });
  });

  test("허용 없이 끝난 다른 호출이나 본 세션의 Post hook은 sub-agent의 ?에 이어 붙지 않는다", () => {
    const state = apply(
      emptyOfficeState(),
      connect,
      fromAgent("PermissionRequest"),
      fromAgent("PostToolUse", { tool_use_id: "a0", tool_input: { command: "ls" } }),
      { hook_event_name: "PostToolUse", session_id: S, tool_use_id: "m1", tool_name: "Bash", tool_input: { command: "pwd" } }
    );

    expect(statusOf(state)).toEqual([[expect.stringMatching(/^permission-/), "waiting"]]);
  });

  test("/office로 연결하지 않은 세션의 허용 요청과 끝 신호는 사무실에 들이지 않는다", () => {
    const state = apply(emptyOfficeState(), fromAgent("PermissionRequest"), fromAgent("PostToolUse", { tool_use_id: "a1" }));

    expect(state.sessions[S]).toBeUndefined();
  });
});

describe("서버가 세션의 시작을 보지 못했을 때", () => {
  const pre = { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "t1", tool_name: "Read", tool_input: {} };

  test("연결 신호가 아닌 이벤트로 처음 알게 된 세션은 이전 상태를 모른다고 표시한다", () => {
    expect(session(apply(emptyOfficeState(), pre))).toMatchObject({ priorUnknown: true });
    expect(session(apply(emptyOfficeState(), connect, pre))).toMatchObject({ priorUnknown: false });
  });

  test("이전 상태를 모르는 동안은 일이 끝나도 불을 끄지 않는다", () => {
    const state = apply(emptyOfficeState(), pre, { hook_event_name: "PostToolUse", session_id: S, tool_use_id: "t1" });

    expect(session(state)).toMatchObject({ characters: [], doneCount: 1, priorUnknown: true, lit: true });
  });

  test("턴이 끝나면 남은 허용 창이 없으므로 다시 상태를 알고, 일이 없으면 불이 꺼진다", () => {
    const state = apply(emptyOfficeState(), pre, { hook_event_name: "Stop", session_id: S });

    expect(session(state)).toMatchObject({ priorUnknown: false, lit: false });
  });

  test("이벤트를 반영해도 서버 instance 값은 그대로 남는다", () => {
    const state = applyHookEvent({ ...emptyOfficeState(), instance: "server-1" }, connect, 1_000);

    expect(state.instance).toBe("server-1");
  });
});

describe("턴 진행 중", () => {
  const read = (id: string) => ({ hook_event_name: "PreToolUse", session_id: S, tool_use_id: id, tool_name: "Read", tool_input: {} });
  const done = (id: string) => ({ hook_event_name: "PostToolUse", session_id: S, tool_use_id: id, tool_name: "Read", tool_input: {} });

  test("도구 호출 사이에 Claude가 생각하는 동안에도 불이 켜져 있다", () => {
    const state = apply(emptyOfficeState(), connect, { hook_event_name: "UserPromptSubmit", session_id: S }, read("t1"), done("t1"));

    expect(session(state)).toMatchObject({ characters: [], doneCount: 1, inTurn: true, lit: true });
  });

  test("턴 시작을 놓쳐도 도구 호출을 보면 턴 중으로 안다", () => {
    const state = apply(emptyOfficeState(), connect, read("t1"), done("t1"));

    expect(session(state)).toMatchObject({ inTurn: true, lit: true });
  });

  test("Stop이 오면 턴이 끝나 불이 꺼진다", () => {
    const state = apply(emptyOfficeState(), connect, { hook_event_name: "UserPromptSubmit", session_id: S }, read("t1"), done("t1"), {
      hook_event_name: "Stop",
      session_id: S,
    });

    expect(session(state)).toMatchObject({ inTurn: false, lit: false });
  });
});

describe("세션 마무리", () => {
  test("Stop 이벤트가 오면 남은 캐릭터가 모두 나간다", () => {
    const state = apply(
      emptyOfficeState(),
      connect,
      { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "t1", tool_name: "Read", tool_input: {} },
      { hook_event_name: "Stop", session_id: S }
    );

    expect(session(state)).toMatchObject({ characters: [], doneCount: 1 });
  });

  test("SessionEnd가 오면 세션이 연결 해제되고 불이 꺼진다", () => {
    const state = apply(emptyOfficeState(), connect, {
      hook_event_name: "SessionEnd",
      session_id: S,
    });

    expect(session(state)).toMatchObject({ connected: false, lit: false, characters: [] });
  });

  // 사용자 설정과 프로젝트 설정에 모두 SessionEnd hook이 있으면 같은 종료가 두 번 온다.
  test("SessionEnd가 두 번 와도 한 번 온 것과 같고, 완료 건수도 두 번 세지 않는다", () => {
    const end = { hook_event_name: "SessionEnd", session_id: S };
    const work = { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "t1", tool_name: "Read", tool_input: {} };
    const once = apply(emptyOfficeState(), connect, work, end);
    const twice = apply(emptyOfficeState(), connect, work, end, end);

    expect(session(twice)).toMatchObject({ connected: false, lit: false, characters: [], doneCount: 1 });
    expect(twice.order).toEqual(once.order);
  });

  test("세션이 여럿이면 서로 영향을 주지 않는다", () => {
    const state = apply(
      emptyOfficeState(),
      connect,
      { hook_event_name: "OfficeConnect", session_id: "session-2", project: "blog" },
      { hook_event_name: "PreToolUse", session_id: "session-2", tool_use_id: "x", tool_name: "Read", tool_input: {} }
    );

    expect(session(state).characters).toEqual([]);
    expect(session(state, "session-2").characters).toHaveLength(1);
    expect(state.order).toEqual([S, "session-2"]);
  });

  const HERE = "/work/a/side-project";
  const connectAt = (id: string, cwd?: string) => ({
    hook_event_name: "OfficeConnect", session_id: id, project: "side-project", ...(cwd ? { cwd } : {}),
  });
  const finishedOne = [
    { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "t1", tool_name: "Read", tool_input: {} },
    { hook_event_name: "Stop", session_id: S },
  ];

  test("/clear로 같은 경로에 새 세션이 연결되면 일이 없는 이전 세션 탭을 내린다", () => {
    const state = apply(emptyOfficeState(), connectAt(S, HERE), ...finishedOne, connectAt("session-2", HERE));

    expect(state.order).toEqual(["session-2"]);
    expect(state.sessions[S]).toBeUndefined();
  });

  test("이전 세션의 경로를 연결 신호가 아닌 hook 이벤트의 cwd로 알아도 내린다", () => {
    const state = apply(
      emptyOfficeState(),
      connectAt(S),
      { hook_event_name: "Stop", session_id: S, cwd: HERE },
      connectAt("session-2", HERE)
    );

    expect(state.order).toEqual(["session-2"]);
  });

  test("도구 없이 생각하며 턴을 진행 중인 이전 세션은 내리지 않는다", () => {
    const state = apply(
      emptyOfficeState(),
      connectAt(S, HERE),
      { hook_event_name: "UserPromptSubmit", session_id: S },
      connectAt("session-2", HERE)
    );

    expect(state.order).toEqual([S, "session-2"]);
  });

  test("폴더 이름만 같은 다른 저장소의 세션은 내리지 않는다", () => {
    const state = apply(emptyOfficeState(), connectAt(S, HERE), ...finishedOne, connectAt("session-2", "/work/b/side-project"));

    expect(state.order).toEqual([S, "session-2"]);
  });

  test("경로가 없는 연결 신호로는 아무 세션도 내리지 않는다", () => {
    const state = apply(emptyOfficeState(), connectAt(S, HERE), ...finishedOne, connectAt("session-2"));

    expect(state.order).toEqual([S, "session-2"]);
  });

  test("이전 세션에 허용을 기다리거나 일하는 캐릭터가 있으면 내리지 않는다", () => {
    const state = apply(
      emptyOfficeState(),
      connectAt(S, HERE),
      { hook_event_name: "PreToolUse", session_id: S, tool_use_id: "t1", tool_name: "Bash", tool_input: { command: "x" } },
      { hook_event_name: "PermissionRequest", session_id: S, tool_name: "Bash", tool_input: { command: "x" } },
      connectAt("session-2", HERE)
    );

    expect(state.order).toEqual([S, "session-2"]);
  });

  test("내린 세션이 살아 있어 다시 이벤트를 보내면 그동안의 상태 그대로 되살린다", () => {
    const state = apply(
      emptyOfficeState(),
      connectAt(S, HERE),
      ...finishedOne,
      connectAt("session-2", HERE),
      { hook_event_name: "Stop", session_id: S }
    );

    expect(state.order).toEqual(["session-2", S]);
    expect(session(state)).toMatchObject({ connected: true, priorUnknown: false, doneCount: 1 });
    expect(state.retired?.[S]).toBeUndefined();
  });

  test("session_id가 없는 이벤트는 무시한다", () => {
    const state = apply(emptyOfficeState(), { hook_event_name: "PreToolUse" });

    expect(state.order).toEqual([]);
  });
});

describe("task 목록", () => {
  const plan = (id: string, input: Record<string, unknown>, event = "PostToolUse") => ({
    hook_event_name: event,
    session_id: S,
    tool_name: "mcp__ccd_turn__update_plan",
    tool_use_id: id,
    tool_input: input,
  });
  const items = {
    items: [{ content: "찾기", status: "in_progress" }, { content: "고치기", status: "pending" }],
  };

  test("실행된 update_plan 호출로 세션의 task 목록을 만들고 바꾼다", () => {
    const state = apply(emptyOfficeState(), connect, plan("p1", items), plan("p2", { advance: true }));

    expect(session(state).plan).toEqual([
      { content: "찾기", status: "completed" },
      { content: "고치기", status: "in_progress" },
    ]);
  });

  test("같은 호출이 Post hook과 transcript 기록으로 두 번 와도 한 번만 반영한다", () => {
    const state = apply(
      emptyOfficeState(),
      connect,
      plan("p1", items),
      plan("p2", { advance: true }),
      plan("p2", { advance: true }, "TranscriptExecuted")
    );

    expect(session(state).plan?.map((i) => i.status)).toEqual(["completed", "in_progress"]);
  });

  test("실행 전(PreToolUse)이나 실패한 호출은 목록을 바꾸지 않는다", () => {
    const state = apply(
      emptyOfficeState(),
      connect,
      plan("p1", items, "PreToolUse"),
      plan("p1", items, "PostToolUseFailure")
    );

    expect(session(state).plan).toBeUndefined();
  });

  test("실패한 호출은 Failure hook 뒤에 transcript의 실행 신호가 와도 목록을 바꾸지 않는다", () => {
    const state = apply(
      emptyOfficeState(),
      connect,
      plan("p1", items),
      plan("p2", { advance: true }, "PostToolUseFailure"),
      { ...plan("p2", { advance: true }, "TranscriptExecuted"), failed: true }
    );

    expect(session(state).plan?.map((i) => i.status)).toEqual(["in_progress", "pending"]);
  });

  test("task 목록을 쓰지 않는 세션에는 목록이 없다", () => {
    const state = apply(emptyOfficeState(), connect, {
      hook_event_name: "PostToolUse", session_id: S, tool_name: "Read", tool_use_id: "r1", tool_input: { file_path: "/a.ts" },
    });

    expect(session(state).plan).toBeUndefined();
  });
});
