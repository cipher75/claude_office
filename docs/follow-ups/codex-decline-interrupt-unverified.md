# 일부 코드 모드 거절은 내부 실행 ID를 확정할 수 없음

**증상** — 정적 셸 호출 하나와 변형하지 않은 `Promise.allSettled` 결과는 복구하지만, 동적 명령·동일 입력의 복수 후보·실패 대상을 구분할 결과가 없는 여러 순차 호출에서는 허용 대기가 Stop까지 남을 수 있다.

**확인한 근거** — 2026-11-10 ChatGPT 앱 내장 Codex 0.167.0-alpha.3.2의 실제 App Server 승인 요청에 decline을 응답했다. 실행 알림에는 `declined`와 내부 exec ID가 있었지만 transcript에는 해당 CommandExecution item_completed가 없었다. 대신 바깥 코드 호출 결과에 `exec_command failed: CreateProcess`와 `Rejected("rejected by user")`가 남았다. 바깥 call_id와 내부 exec ID는 다르다. 두 호출을 실제 거절한 세션 `01a1c337-d7e1-7b50-91c9-4363c2ee5841`의 allSettled 결과에는 원래 배열 순서대로 status와 거절 reason이 남았다.

**시도한 조치** — 단일 정적 셸 호출과 allSettled의 배열·순서별 출력을 acorn으로 읽는다. 다른 도구가 섞인 배열도 위치를 보존하며 거절된 셸 항목만 같은 턴·명령·시간 범위의 유일한 캐릭터에 연결한다. 해석하지 못한 다른 코드가 같은 시간에 실행 중이면 그 코드에 속할 가능성도 남겨 보류한다. 반영한 항목 ID는 재사용하지 않는다. 2026-11-10 01:30 UTC까지의 중복 call_id를 제거한 기록 354개를 동일 조건으로 비교했을 때 지원 구문이 85개(24%)에서 163개(46%)로 늘었다. 실제 승인 대상만의 표본이나 실제 거절 감지율을 측정한 수치는 아니다.

**실제 hook 검증** — 단일 호출 세션 `01a1c32c-bf93-7531-82ec-4f1e802c75eb`, 병렬 두 호출 세션 `01a1c33d-1e33-7070-af0c-4f750f14254f`에서 native PreToolUse·PermissionRequest hook → 기록 파일 감시 → denied를 확인했다. 세션 `01a1c346-1abd-7692-b4de-94e2609a623f`에서는 병렬 첫 명령을 accept, 둘째를 decline으로 응답하고 실행 ID별 approved·denied, 브라우저의 “허용됨 · 일 마쳤어요”·“거절됨 · 퇴근할게요”를 함께 확인했다. 시작·허용 요청을 알림에서 합성하지 않았다(OfficeConnect만 시험 준비로 전송). 시험 서버는 4749번을 사용했다. 현재 프로젝트 hook 해시만 시험 동안 임시 신뢰 등록하고 추가한 등록을 복원했다. CLI의 No는 실제 시험에서 aborted by user와 Interrupt로 기록되어 중단으로 유지한다. 실제 Esc 뒤 명령이 계속 실행되어 completed가 되는 경로도 중단 시각 검사로 보완했다.

**남은 원인과 다음 확인** — 임의의 JavaScript는 구문만으로 내부 실행 순서와 인수를 확정하기 어렵다. `exec`가 먼저 yield하고 후속 `wait`에서 결과를 받는 경우도 별도 연결이 필요하다. App Server의 별도 관찰 클라이언트는 승인 요청에 응답하지 않아도 정확한 실행 ID와 declined 알림을 받는 것을 시험했다. 하지만 현재 데스크톱 앱의 App Server는 stdio 연결이며 외부 관찰 소켓을 열지 않는다. 기본 데몬 proxy의 loaded 목록에도 해당 세션이 없으므로 현재 데스크톱의 해결책으로 적용하지 않았다. 공식 hook에 거절 신호/실행 ID가 추가되거나 데스크톱의 관찰 연결이 제공되면 재검토한다. 확정할 수 없는 거절을 오류 문구나 가장 최근 호출만 보고 임의로 연결하지 않는다.
