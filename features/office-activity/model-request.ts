// `!` 명령 결과처럼 UserPromptSubmit hook 없이 시작되는 턴이 있다. 그래도 Claude가 답을 쓰기 시작하면
// 본 세션 transcript에 모델 호출 기록(api-request)이 붙으므로, 그 시각으로 턴이 진행 중인 것을 안다.

const MAIN_THREAD = "repl_main_thread";

// 줄들 가운데 본 세션 모델 호출의 가장 늦은 시각(ms). 없으면 undefined.
export function latestModelRequestAt(lines: string): number | undefined {
  let latest: number | undefined;
  for (const line of lines.split("\n")) {
    if (!line.includes('"api-request"')) continue;
    const at = mainThreadRequestAt(line);
    if (at !== undefined && (latest === undefined || at > latest)) latest = at;
  }
  return latest;
}

function mainThreadRequestAt(line: string): number | undefined {
  try {
    const entry: unknown = JSON.parse(line);
    if (typeof entry !== "object" || entry === null) return undefined;
    const record = entry as Record<string, unknown>;
    if (record.type !== "api-request" || record.isSidechain === true) return undefined;
    if (typeof record.querySource !== "string" || !record.querySource.startsWith(MAIN_THREAD)) return undefined;
    const at = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : NaN;
    return Number.isFinite(at) ? at : undefined;
  } catch {
    return undefined;
  }
}
