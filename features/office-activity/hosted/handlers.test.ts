import { describe, expect, test } from "vitest";

import { applyHookEvent, emptyOfficeState } from "../session-state";
import type { OfficeState } from "../types";
import { createHostedHandlers } from "./handlers";
import { redactState } from "./redact";
import type { HostedMachine, HostedStore } from "./types";

const SEND = "send-token-123";
const VIEW = "view-token-456";
const NOW = 1_000_000;

function memoryStore(): HostedStore & { fields: Map<string, string>; removed: string[] } {
  const fields = new Map<string, string>();
  const removed: string[] = [];
  return {
    fields,
    removed,
    async put(machine: HostedMachine) {
      fields.set(machine.machine, JSON.stringify(machine));
    },
    async all() {
      return [...fields.values()];
    },
    async remove(machines: string[]) {
      machines.forEach((m) => {
        fields.delete(m);
        removed.push(m);
      });
    },
  };
}

function setup(now = NOW) {
  const store = memoryStore();
  const handlers = createHostedHandlers({ sendToken: SEND, viewToken: VIEW, store, now: () => now });
  return { store, handlers };
}

const state: OfficeState = {
  sessions: {
    s1: {
      id: "s1",
      name: "side-project",
      connected: true,
      lit: true,
      doneCount: 1,
      characters: [{ id: "t1", kind: "tool", status: "working", label: "Read · a.md", toolName: "Read", toolInput: null, since: 1 }],
    },
  },
  order: ["s1"],
};

function push(body: unknown, token: string | null = SEND) {
  return new Request("https://office.test/api/hosted/push", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

function view(token: string | null = VIEW) {
  return new Request("https://office.test/api/hosted/state", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

const goodPush = { machine: "work-pc", heartbeatSec: 20, state };

describe("PC가 상태를 올리는 길", () => {
  test.each(["SessionEnd", "OfficeDisconnect"])("%s로 끝난 세션 51개가 있어도 현재 세션의 갱신을 받는다", async (end) => {
    const { handlers, store } = setup();
    let local = emptyOfficeState();
    let at = 1_000;
    const send = (id: string, name: string, extra: Record<string, unknown> = {}) => {
      local = applyHookEvent(local, { session_id: id, hook_event_name: name, ...extra }, ++at);
    };
    for (let i = 0; i < 51; i++) {
      send(`ended-${i}`, "OfficeConnect");
      send(`ended-${i}`, end);
    }
    send("thinking", "OfficeConnect");
    send("thinking", "UserPromptSubmit");
    send("waiting", "OfficeConnect");
    const call = { tool_use_id: "t1", tool_name: "Read", tool_input: { file_path: "/private/PRODUCT.md" } };
    send("waiting", "PreToolUse", call);
    send("waiting", "PermissionRequest", call);

    expect((await handlers.push(push({ ...goodPush, state: redactState(local) }))).status).toBe(200);
    const saved = JSON.parse(store.fields.get("work-pc")!).state as OfficeState;
    expect(saved.order).toEqual(["thinking", "waiting"]);
    expect(Object.keys(saved.sessions)).toHaveLength(2);
    expect(saved.sessions.waiting.characters[0]).toMatchObject({ status: "waiting", toolInput: null });
    expect(saved.sessions.thinking).toMatchObject({ connected: true, inTurn: true, characters: [] });
    expect(Object.keys(local.sessions)).toHaveLength(53);

    send("thinking", end);
    send("waiting", end);
    expect((await handlers.push(push({ ...goodPush, state: redactState(local) }))).status).toBe(200);
    expect(JSON.parse(store.fields.get("work-pc")!).state).toMatchObject({ sessions: {}, order: [] });

    send("ended-0", "OfficeConnect");
    expect((await handlers.push(push({ ...goodPush, state: redactState(local) }))).status).toBe(200);
    expect(JSON.parse(store.fields.get("work-pc")!).state.order).toEqual(["ended-0"]);
  });

  test("보내기 토큰이 맞으면 받은 시각과 함께 저장한다", async () => {
    const { handlers, store } = setup();

    const response = await handlers.push(push(goodPush));

    expect(response.status).toBe(200);
    expect(JSON.parse(store.fields.get("work-pc")!)).toMatchObject({ machine: "work-pc", heartbeatSec: 20, receivedAt: NOW });
  });

  test("토큰이 없거나 틀리면 받지 않고 아무것도 저장하지 않는다", async () => {
    const { handlers, store } = setup();

    expect((await handlers.push(push(goodPush, null))).status).toBe(401);
    expect((await handlers.push(push(goodPush, "wrong"))).status).toBe(401);
    expect(store.fields.size).toBe(0);
  });

  test("보기 토큰으로는 상태를 올릴 수 없다", async () => {
    const { handlers, store } = setup();

    expect((await handlers.push(push(goodPush, VIEW))).status).toBe(401);
    expect(store.fields.size).toBe(0);
  });

  test("호출 입력이 남아 있는 상태는 거절한다", async () => {
    const { handlers, store } = setup();
    const raw = structuredClone(state);
    raw.sessions.s1.characters[0].toolInput = { command: "echo SECRET" };

    const response = await handlers.push(push({ ...goodPush, state: raw }));

    expect(response.status).toBe(400);
    expect(store.fields.size).toBe(0);
  });

  test("모양이 맞지 않는 본문은 거절한다", async () => {
    const { handlers } = setup();

    expect((await handlers.push(push({ machine: "work-pc" }))).status).toBe(400);
    expect((await handlers.push(push({ ...goodPush, machine: "" }))).status).toBe(400);
    expect((await handlers.push(push({ ...goodPush, machine: "a/b" }))).status).toBe(400);
    expect((await handlers.push(push({ ...goodPush, heartbeatSec: 0 }))).status).toBe(400);
    expect((await handlers.push(new Request("https://office.test/x", { method: "POST", headers: { authorization: `Bearer ${SEND}` }, body: "not json" }))).status).toBe(400);
  });
});

describe("기기가 상태를 보는 길", () => {
  test("보기 토큰이 맞으면 PC들의 상태와 호스팅의 지금 시각을 준다", async () => {
    const { handlers } = setup();
    await handlers.push(push(goodPush));
    await handlers.push(push({ ...goodPush, machine: "laptop" }));

    const response = await handlers.state(view());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.serverNow).toBe(NOW);
    expect(body.machines.map((m: HostedMachine) => m.machine)).toEqual(["laptop", "work-pc"]);
  });

  test("토큰이 없거나 틀리면 상태를 주지 않는다", async () => {
    const { handlers } = setup();
    await handlers.push(push(goodPush));

    const missing = await handlers.state(view(null));
    const wrong = await handlers.state(view("wrong"));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).not.toContain("side-project");
  });

  test("보내기 토큰으로는 화면을 볼 수 없다", async () => {
    const { handlers } = setup();

    expect((await handlers.state(view(SEND))).status).toBe(401);
  });

  test("저장된 것이 없으면 빈 목록이다", async () => {
    const { handlers } = setup();

    expect(await (await handlers.state(view())).json()).toEqual({ serverNow: NOW, machines: [] });
  });

  test("오랫동안 소식이 없는 PC는 목록에서 빼고 저장소에서도 지운다", async () => {
    const store = memoryStore();
    const older = createHostedHandlers({ sendToken: SEND, viewToken: VIEW, store, now: () => NOW });
    await older.push(push({ ...goodPush, machine: "old-pc" }));
    const later = createHostedHandlers({ sendToken: SEND, viewToken: VIEW, store, now: () => NOW + 7 * 60 * 60 * 1000 });
    await later.push(push({ ...goodPush, machine: "new-pc" }));

    const body = await (await later.state(view())).json();

    expect(body.machines.map((m: HostedMachine) => m.machine)).toEqual(["new-pc"]);
    expect(store.removed).toEqual(["old-pc"]);
  });

  test("읽을 수 없는 저장 값은 건너뛴다", async () => {
    const { handlers, store } = setup();
    store.fields.set("broken", "{not json");
    await handlers.push(push(goodPush));

    const body = await (await handlers.state(view())).json();

    expect(body.machines.map((m: HostedMachine) => m.machine)).toEqual(["work-pc"]);
  });
});

describe("저장소 문제", () => {
  test("저장소가 실패하면 PC에는 실패로, 기기에는 오류로 알린다", async () => {
    const broken: HostedStore = {
      put: async () => { throw new Error("down"); },
      all: async () => { throw new Error("down"); },
      remove: async () => {},
    };
    const handlers = createHostedHandlers({ sendToken: SEND, viewToken: VIEW, store: broken, now: () => NOW });

    expect((await handlers.push(push(goodPush))).status).toBe(502);
    expect((await handlers.state(view())).status).toBe(502);
  });
});
