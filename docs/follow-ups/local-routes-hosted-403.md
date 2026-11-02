# 호스팅에서 로컬 전용 라우트가 404 대신 403을 줌

`proxy.ts`가 라우트보다 먼저 돌아 호스팅 배포에서 `/api/events`, `/api/stream`이 403을 돌려준다. 라우트의 `isHostedDeployment()` 404 분기는 닿지 않는다(2026-11-02 `/code-review`).
