"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { OfficeBoard, type Link } from "../office-view";
import { emptyOfficeState } from "../session-state";
import type { OfficeState, StaleMachine } from "../types";
import { composeHostedState, isBusy, nextPollDelayMs } from "./compose";
import type { HostedSnapshot } from "./types";

// 호스팅 화면: 기기에서 보기 토큰을 한 번 넣으면, 호스팅에 올라온 PC들의 상태를 가져와 사무실로 보여준다. 보기 전용이다.

const TOKEN_KEY = "office.viewToken";

export function HostedOfficeView() {
  // undefined: 서버에서 그리는 동안에는 이 기기에 기억된 토큰을 알 수 없어 비워 둔다. 브라우저에서 읽으면 null이나 토큰이 된다.
  const token = useSyncExternalStore(subscribeToken, readToken, () => undefined);
  const [rejected, setRejected] = useState(false);

  if (token === undefined) return null;
  if (!token) {
    return (
      <TokenForm
        rejected={rejected}
        onSubmit={(value) => {
          setRejected(false);
          saveToken(value);
        }}
      />
    );
  }
  return (
    <HostedBoard
      token={token}
      onRejected={() => {
        setRejected(true);
        clearToken();
      }}
    />
  );
}

function TokenForm({ rejected, onSubmit }: { rejected: boolean; onSubmit: (token: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <form
      className="mx-auto flex w-full max-w-sm flex-col gap-4 py-10"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight">오늘의 사무실</h1>
        <p className="text-sm text-muted-foreground">내 PC의 Claude 활동을 보려면 보기 토큰이 필요해요.</p>
      </div>
      <FieldGroup>
        <Field data-invalid={rejected || undefined}>
          <FieldLabel htmlFor="view-token">보기 토큰</FieldLabel>
          <Input
            id="view-token"
            type="password"
            autoComplete="off"
            value={value}
            aria-invalid={rejected || undefined}
            onChange={(event) => setValue(event.target.value)}
          />
          <FieldDescription>한 번 넣으면 이 기기에서는 다시 묻지 않아요.</FieldDescription>
        </Field>
      </FieldGroup>
      {rejected ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          토큰이 맞지 않아요. 호스팅에 정한 보기 토큰을 다시 넣어 주세요.
        </p>
      ) : null}
      <Button type="submit" disabled={!value.trim()}>
        열기
      </Button>
    </form>
  );
}

function HostedBoard({ token, onRejected }: { token: string; onRejected: () => void }) {
  const { state, link, stale, staleSessions, restarted, acknowledgeRestart } = useHostedState(token, onRejected);
  return (
    <OfficeBoard
      state={state}
      link={link}
      restarted={restarted}
      onAcknowledgeRestart={acknowledgeRestart}
      subtitle="내 PC들의 Claude · Codex 세션의 활동을 보여줍니다. 이 기기에서는 보기만 할 수 있어요"
      staleMachines={stale}
      staleSessions={staleSessions}
    />
  );
}

// 호스팅의 상태를 주기적으로 가져온다. 일이 있으면 자주, 없으면 드물게, 탭이 숨겨지면 멈추고 다시 보이면 바로 가져온다.
function useHostedState(token: string, onRejected: () => void) {
  const [state, setState] = useState<OfficeState>(emptyOfficeState);
  const [link, setLink] = useState<Link>("connecting");
  const [stale, setStale] = useState<StaleMachine[]>([]);
  const [staleSessions, setStaleSessions] = useState<Record<string, number>>({});
  const [restarted, setRestarted] = useState(false);
  const instances = useRef<Record<string, string>>({});
  const rejectedRef = useRef(onRejected);
  useEffect(() => {
    rejectedRef.current = onRejected;
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    // 가져오는 중에 또 부르면 요청이 겹치고, 끝날 때마다 다음 예약이 하나씩 늘어 조회가 갈수록 잦아진다.
    let polling = false;
    const controller = new AbortController();

    const schedule = () => {
      if (cancelled) return;
      clearTimeout(timer);
      const delay = nextPollDelayMs({ busy, hidden: document.visibilityState === "hidden" });
      // 탭이 숨겨졌으면 멈춘다. 다시 보이면 visibilitychange에서 바로 가져온다.
      if (delay !== null) timer = setTimeout(poll, delay);
    };

    async function poll() {
      if (polling) return;
      polling = true;
      clearTimeout(timer);
      try {
        await fetchOnce();
      } finally {
        polling = false;
      }
      schedule();
    }

    async function fetchOnce() {
      try {
        const response = await fetch("/api/hosted/state", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (cancelled) return;
        if (response.status === 401) {
          rejectedRef.current();
          return;
        }
        if (!response.ok) throw new Error(String(response.status));

        const composed = composeHostedState((await response.json()) as HostedSnapshot);
        if (cancelled) return;
        for (const [machine, instance] of Object.entries(composed.instances)) {
          const before = instances.current[machine];
          if (before && before !== instance) setRestarted(true);
          instances.current[machine] = instance;
        }
        busy = isBusy(composed.state);
        setState(composed.state);
        setStale(composed.stale);
        setStaleSessions(composed.staleSessions);
        setLink("open");
      } catch {
        if (cancelled) return;
        setLink("lost");
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    void poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token]);

  return { state, link, stale, staleSessions, restarted, acknowledgeRestart: () => setRestarted(false) };
}

// 브라우저 저장소를 못 쓰는 환경(시크릿 창 등)에서도 화면은 동작해야 하므로 모든 접근을 감싼다.
// 저장소를 못 쓰면 이번 방문 동안만 메모리에 둔다.
let memoryToken: string | null = null;
const tokenListeners = new Set<() => void>();

function subscribeToken(listener: () => void) {
  tokenListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    tokenListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

function saveToken(token: string) {
  memoryToken = token;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // 기억하지 못해도 이번 방문에는 쓸 수 있다.
  }
  tokenListeners.forEach((listener) => listener());
}

function clearToken() {
  memoryToken = null;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 지우지 못해도 다음 요청이 다시 거절한다.
  }
  tokenListeners.forEach((listener) => listener());
}
