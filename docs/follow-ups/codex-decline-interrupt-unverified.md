# 복잡한 코드 모드 호출의 거절을 내부 실행 ID에 연결할 수 없음

**증상** — 단일 정적 셸 호출의 거절은 복구하지만, 동적 명령·여러 내부 호출·동일 입력의 복수 후보에서는 어떤 사무실 캐릭터가 거절됐는지 확정하지 못한다.

**확인한 근거** — 2026-11-10 ChatGPT 앱 내장 Codex 0.167.0-alpha.3.2의 실제 App Server 승인 요청에 decline을 응답했다. 세션 `01a1c309-9e56-74e2-ae1e-3e25d712f3c8`의 실행 알림은 `declined`였지만 transcript에 CommandExecution item_completed는 없었다. 대신 코드 모드의 바깥 호출 결과에 `exec_command failed: CreateProcess`와 `Rejected("rejected by user")`가 남았다. 바깥 call_id와 실제 exec ID는 다르다. 임의의 JavaScript는 정적인 구문 분석만으로 내부 실행 순서와 인수를 확정하기 어렵다.

**추정 원인** — 기록의 코드 모드 결과에는 내부 실행 ID가 없으며, 공식 App Server 승인 알림의 실행 ID가 transcript에 항상 저장되지 않는다.

**시도한 조치** — 단일 정적 tools.exec_command 호출의 구문을 acorn으로 읽고, 같은 턴·명령·호출 시간 범위에 해당하는 유일한 캐릭터를 거절 처리한다. 반영한 바깥 호출 ID는 재사용하지 않는다. 실제 승인 요청과 실행 ID를 사무실 입력에 연결한 세션 `01a1c314-ce0a-7ab1-8c11-9c9526d6a096`에서 native decline, 실제 기록 파일 감시, 사무실 denied 복구를 확인했다. App Server 시험의 시작·허용 요청은 알림에서 기존 hook 입력 형태로 전달했다. 대화형 CLI의 No 선택 시험은 aborted by user와 Interrupt로 기록됐으며 중단으로 유지한다. 실제 Esc 뒤 명령이 계속 실행돼 completed가 되는 경로도 중단 시각 검사로 보완했다. 시험 실행에만 검토한 hook 신뢰 우회 옵션을 사용했다.

**다음 확인** — 코드 모드 내부 호출 ID를 받을 공식 신호를 확인하거나, 사용자의 승인 처리를 가로채지 않는 App Server 관찰 연결을 검토한다. 동적 명령과 같은 명령의 병렬 호출을 실제 세션에서 검증한다. 대상을 확정할 수 없는 거절은 입력이나 오류 문구만으로 임의의 캐릭터에 연결하지 않는다.
