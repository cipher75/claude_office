// 시작만 알리고 뒤에서 계속 도는 호출인지를 그 응답으로 안다. 이런 호출은 끝났다는 hook 이벤트가 없고,
// 끝나면 세션 transcript에 작업 완료 알림(task-notification)이 붙는다.
// - Agent(run_in_background): { isAsync: true, agentId }
// - Bash(run_in_background): { backgroundTaskId }
// - Monitor: { taskId, timeoutMs, persistent }
export function isBackgroundLaunch(response: unknown): boolean {
  if (typeof response !== "object" || response === null || Array.isArray(response)) return false;
  const r = response as Record<string, unknown>;
  return r.isAsync === true || typeof r.backgroundTaskId === "string" ||
    (typeof r.taskId === "string" && typeof r.persistent === "boolean");
}
