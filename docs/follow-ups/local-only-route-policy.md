# 로컬 전용 라우트 정책이 흩어져 있음

로컬 전용 라우트 목록이 `proxy.ts`의 경로 나열 matcher와 각 라우트의 `isHostedDeployment()` 두 곳에 있다. 새 로컬 라우트는 matcher에서 빠지기 쉽고, 정책이 `features/office-activity` 밖 루트 파일에 있으며 테스트가 없다. 4747 포트도 `package.json`과 `.claude/skills/office/SKILL.md`에 따로 적혀 있다(2026-11-02 `/code-review`).
