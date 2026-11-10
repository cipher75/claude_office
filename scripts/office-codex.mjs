import { basename } from "node:path";

// command hook은 stdin을 전달하고, 연결 명령은 현재 Codex 세션 id를 사용한다.
const mode = process.argv[2] ?? "hook";
const manual = mode === "connect" || mode === "close";
try {
  if (!manual && mode !== "hook") throw new Error("connect, close, hook 중 하나를 지정하세요.");
  let payload;
  if (manual) {
    if (!process.env.CODEX_THREAD_ID) throw new Error("Codex 세션 안에서 실행하세요. CODEX_THREAD_ID가 필요합니다.");
    payload = {
      hook_event_name: mode === "connect" ? "OfficeConnect" : "OfficeDisconnect",
      session_id: process.env.CODEX_THREAD_ID,
      cwd: process.cwd(),
      project: basename(process.cwd()),
    };
  } else {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    payload = JSON.parse(input);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("잘못된 hook 입력입니다.");
  }
  const url = new URL(process.env.OFFICE_CODEX_URL ?? "http://127.0.0.1:4747/api/events");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("사무실 이벤트는 로컬 HTTP 주소로만 보낼 수 있습니다.");
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, source: "codex" }),
    signal: AbortSignal.timeout(1_500),
  });
  if (!response.ok) throw new Error(`사무실 서버 응답 ${response.status}`);
  if (manual) console.log(mode === "connect" ? "Codex 사무실 연결 완료" : "Codex 사무실 연결 해제 완료");
} catch (error) {
  // 관찰용 hook 실패가 도구 실행이나 허용 결정을 막지 않게 한다.
  if (manual) {
    console.error(`사무실 연결 실패 · ${error.message}`);
    // Codex 샌드박스는 127.0.0.1로 나가는 연결도 막는다. hook은 샌드박스 밖에서 돌아 영향이 없다.
    if (error.message === "fetch failed") {
      console.error("bun run office로 서버를 켰는데도 실패했다면 주소·포트를 확인하세요. Codex 샌드박스의 네트워크 제한일 수도 있습니다. 샌드박스 밖에서 실행하도록 권한 상승을 승인해 다시 실행하세요.");
    }
    process.exitCode = 1;
  }
} finally {
  if (!manual) console.log("{}");
}
