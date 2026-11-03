import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Node 25부터 기본으로 켜진 내장 Web Storage(localStorage)가 jsdom의 것을 가려, 저장소를 쓰는 화면 테스트가 깨진다.
// 테스트 worker에서만 끈다. 이 옵션을 모르는 Node에 넘기면 worker가 뜨지 않으므로 지원할 때만 넘긴다.
const WEB_STORAGE_OFF = "--no-experimental-webstorage";
const execArgv = process.allowedNodeEnvironmentFlags.has(WEB_STORAGE_OFF) ? [WEB_STORAGE_OFF] : [];

export default defineConfig({
  plugins: [react()],
  // tsconfig.json의 "@/*" 경로 별칭을 Vite가 직접 해석한다.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    execArgv,
    setupFiles: ["./vitest.setup.ts"],
    passWithNoTests: true,
    exclude: [
      "node_modules/**",
      ".next/**",
      "e2e/**",
      ".claude/worktrees/**",
    ],
  },
});
