# transcript 파일 감시 테스트의 간헐적 타임아웃

`NODE_OPTIONS=--no-experimental-webstorage bun run test` 병렬 실행 중 기존 `transcript-watch.test.ts`의 "지켜보기 시작한 뒤 붙은 완성된 줄만 넘긴다"가 `seen: []`인 채 3초 타임아웃으로 한 번 실패했다. 서버 전달 테스트를 파일 감시 타이밍과 분리한 뒤에는 전체 249개가 통과했다. 감시 등록 직후 첫 stat과 파일 추가의 순서 또는 병렬 부하가 영향을 주는지 아직 확인하지 못했다. 해당 테스트의 초기 감시 시점을 분리해 재현하고 실제 앱에서도 줄을 놓치는지 확인한다.
