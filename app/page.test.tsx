import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

import Home from "@/app/page";

beforeEach(() => {
  // jsdom에는 EventSource가 없으므로 아무 메시지도 보내지 않는 구독으로 대신한다.
  vi.stubGlobal(
    "EventSource",
    class {
      close() {}
    }
  );
  // jsdom에는 canvas 2D가 없어 배경과 캐릭터 그리기를 건너뛴다.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
});

test("연결된 세션이 없으면 사무실 제목과 연결 안내를 보여준다", () => {
  render(<Home />);

  expect(screen.getByRole("heading", { level: 1, name: "오늘의 사무실" })).toBeInTheDocument();
  expect(screen.getByText("연결된 세션이 없어요", { selector: "[data-slot=empty-title]" })).toBeInTheDocument();
  expect(screen.getByText("/office")).toBeInTheDocument();
});
