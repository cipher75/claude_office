import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// 명시적으로 연결한 세션 ID의 파일 이름만 찾는다. 다른 세션의 내용은 읽지 않는다.
export function findCodexTranscript(sessionId: string, home = process.env.CODEX_HOME ?? join(homedir(), ".codex")): string | undefined {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)) return;
  const root = join(home, "sessions");
  try {
    const name = readdirSync(root, { recursive: true, encoding: "utf8" }).find((name) => name.endsWith(`-${sessionId}.jsonl`));
    return name ? join(root, name) : undefined;
  } catch { return; }
}
