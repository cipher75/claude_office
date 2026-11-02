import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { OfficeView } from "./office-view";
import type { OfficeState } from "./types";

// 테스트가 서버 대신 연결을 열고, 끊고, 상태를 보낼 수 있는 EventSource.
class FakeEventSource {
  static last: FakeEventSource;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor() {
    FakeEventSource.last = this;
  }
  close() {}
}

function send(state: OfficeState) {
  act(() => FakeEventSource.last.onmessage?.({ data: JSON.stringify(state) }));
}

const empty = (instance: string): OfficeState => ({ sessions: {}, order: [], instance });

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  // jsdom에는 canvas 2D가 없어 배경과 캐릭터 그리기를 건너뛴다.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
});

describe("세션 탭", () => {
  test("새 세션이 연결되면 그 탭을 바로 보여준다", () => {
    render(<OfficeView />);
    const session = (id: string, name: string) => ({
      id, name, connected: true, lit: true, doneCount: 0, characters: [],
    });
    send({ ...empty("i1"), sessions: { a: session("a", "blog") }, order: ["a"] });
    act(() => screen.getByRole("tab", { name: /blog/ }).click());

    send({ ...empty("i1"), sessions: { a: session("a", "blog"), b: session("b", "shop") }, order: ["a", "b"] });

    expect(screen.getByRole("tab", { name: /shop/ })).toHaveAttribute("aria-selected", "true");
  });

  test("퇴근했던 세션이 다시 일을 시작하면 그 탭으로 옮겨 간다", () => {
    render(<OfficeView />);
    const session = (id: string, name: string, lit: boolean) => ({
      id, name, connected: true, lit, doneCount: 1, characters: [],
    });
    const both = (blogLit: boolean, shopLit: boolean) => ({
      ...empty("i1"),
      sessions: { a: session("a", "blog", blogLit), b: session("b", "shop", shopLit) },
      order: ["a", "b"],
    });
    send(both(false, true));
    expect(screen.getByRole("tab", { name: /shop/ })).toHaveAttribute("aria-selected", "true");

    send(both(true, true));
    expect(screen.getByRole("tab", { name: /blog/ })).toHaveAttribute("aria-selected", "true");

    // 계속 일하던 세션에 새 일이 생기는 것만으로는 탭을 옮기지 않는다.
    const busyShop = both(true, true);
    busyShop.sessions.b.doneCount = 5;
    send(busyShop);
    expect(screen.getByRole("tab", { name: /blog/ })).toHaveAttribute("aria-selected", "true");

    // 그 세션이 퇴근했다가 다시 일을 시작하면 옮겨 간다.
    send(both(true, false));
    send(both(true, true));
    expect(screen.getByRole("tab", { name: /shop/ })).toHaveAttribute("aria-selected", "true");
  });
});

describe("화면이 지금 상태를 보여주지 못할 때", () => {
  test("서버와 연결이 끊기면 앱에서 확인하라고 알리고, 다시 연결되면 알림을 거둔다", () => {
    render(<OfficeView />);
    act(() => FakeEventSource.last.onopen?.());
    expect(screen.queryByText(/연결이 끊겼어요/)).toBeNull();

    act(() => FakeEventSource.last.onerror?.());
    expect(screen.getByText(/사무실 서버와 연결이 끊겼어요/)).toBeInTheDocument();
    expect(screen.getByText("연결이 끊겨 지금 상태를 알 수 없어요")).toBeInTheDocument();

    send(empty("server-1"));
    expect(screen.queryByText(/연결이 끊겼어요/)).toBeNull();
  });

  test("서버가 다시 켜지면 그전의 허용 대기를 확인하라고, 사용자가 확인할 때까지 알린다", () => {
    render(<OfficeView />);
    send(empty("server-1"));
    expect(screen.queryByText(/서버가 다시 켜졌어요/)).toBeNull();

    send(empty("server-2"));
    expect(screen.getByText(/사무실 서버가 다시 켜졌어요/)).toBeInTheDocument();

    send(empty("server-2"));
    expect(screen.getByText(/사무실 서버가 다시 켜졌어요/)).toBeInTheDocument();

    act(() => screen.getByRole("button", { name: "확인했어요" }).click());
    expect(screen.queryByText(/서버가 다시 켜졌어요/)).toBeNull();
  });

  test("시작을 보지 못한 세션은 이전 상태를 모른다고 표시한다", () => {
    render(<OfficeView />);
    send({
      instance: "server-1",
      order: ["s1"],
      sessions: {
        s1: { id: "s1", name: "side-project", connected: true, lit: true, doneCount: 0, priorUnknown: true, characters: [] },
      },
    });

    expect(screen.getByText("이전 상태 모름 · 앱에서 확인")).toBeInTheDocument();
    expect(screen.getByText("확인 필요")).toBeInTheDocument();
  });
});
