# Codex 연결 명령이 hook 신뢰 상태를 확인하지 않고 "연결 완료"로 안내함

**증상**: `bun run office:codex connect`는 서버가 연결 신호를 받기만 하면 연결 완료를 출력한다. 프로젝트 hook을 신뢰하지 않았거나 이 실행 경로에서 hook이 오지 않아도 같은 안내가 나온다.

**확인한 근거**: 2026-11-10 실제 4747 서버에서 현재 Codex 세션의 이벤트는 `OfficeConnect` 1건뿐이었고, 여러 도구를 실행한 뒤에도 캐릭터가 없었다. Codex 0.167.0-alpha.3.2의 hooks/list에서 프로젝트 hook 7개가 enabled=true, trustStatus=untrusted였다. 사용자가 hook 7개를 신뢰한 뒤에는 실제 `PreToolUse`·`PermissionRequest`·`PostToolUse`를 받아 화면에 표시하는 것까지 확인했다. `scripts/office-codex.mjs`의 connect는 HTTP 응답 성공만 확인한다.

**지금 상태**: 화면 쪽은 대부분 보완됐다. #38부터 서버가 연결한 세션의 로컬 Codex 기록을 읽어, hook이 없어도 턴과 바깥 도구 호출을 표시한다. 기록도 hook도 없으면 "활동 신호를 아직 받지 못했어요"와 탭의 "활동 확인 필요"로 알린다. 남은 것은 연결 명령의 출력이다. hook이 없으면 허용 대기는 기록만으로 알 수 없는데, 명령은 이 차이를 알려 주지 않는다.

**다음 확인**: connect 단계에서 해당 프로젝트 hook의 신뢰 상태를 확인할 공식 경로가 있는지 본다. 없으면 출력 문구를 "연결 신호 전송 완료"와 "hook 신뢰는 Codex의 hook 검토 화면에서 확인"으로 나눈다. hook 검토·신뢰는 계속 사용자가 직접 한다.
