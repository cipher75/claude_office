import { hostedHandlersFromEnv } from "@/features/office-activity/server";

// PC의 로컬 서버가 줄인 상태를 올리는 길. 보내기 토큰이 맞아야 한다.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const handlers = hostedHandlersFromEnv();
  if (!handlers) return new Response(null, { status: 404 });
  return handlers.push(request);
}
