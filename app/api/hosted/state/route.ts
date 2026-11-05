import { hostedHandlersFromEnv } from "@/features/office-activity/server";

// 기기가 PC들의 상태를 가져가는 길. 보기 토큰이 맞아야 한다.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const handlers = hostedHandlersFromEnv();
  if (!handlers) return new Response(null, { status: 404 });
  return handlers.state(request);
}
