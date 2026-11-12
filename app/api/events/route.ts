import { ingestHookEvent, isHostedDeployment, listRawEvents } from "@/features/office-activity/server";

// 호스팅 배포에는 PC의 hook이 오지 않고, 원본 이벤트에는 명령 내용이 그대로 있다. 이 길은 내 PC의 로컬 서버에만 둔다.
const notHere = () => new Response(null, { status: 404 });

// hook이 보낸 이벤트는 응답 본문을 비워 두어 Claude Code의 동작(허용 여부 등)에 영향을 주지 않는다.
export async function POST(request: Request) {
  if (isHostedDeployment()) return notHere();
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const origin = new URL(request.url).searchParams.get("via") === "settings" ? "settings" : "skill";
  ingestHookEvent(payload as Record<string, unknown>, Date.now(), origin);
  return Response.json({});
}

// 개발 중 hook이 실제로 무엇을 보내는지 확인하기 위한 원본 이벤트 목록.
export async function GET() {
  if (isHostedDeployment()) return notHere();
  return Response.json(listRawEvents());
}
