import { isHostedDeployment, officeSnapshot, pruneAndNotify, subscribeOffice } from "@/features/office-activity/server";

// 화면이 구독하는 SSE 스트림: 연결하자마자 현재 상태를 보내고, 이후 바뀔 때마다 보낸다.
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;
const PRUNE_MS = 3_000;

export async function GET(request: Request) {
  // 호스팅 배포에는 PC의 hook이 오지 않는다. 이 길은 내 PC의 로컬 서버에만 있다.
  if (isHostedDeployment()) return new Response(null, { status: 404 });
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      send(officeSnapshot());
      const unsubscribe = subscribeOffice(send);
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), HEARTBEAT_MS);
      const prune = setInterval(() => pruneAndNotify(), PRUNE_MS);

      cleanup = () => {
        unsubscribe();
        clearInterval(heartbeat);
        clearInterval(prune);
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // 이미 닫힌 스트림이다.
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
    },
  });
}
