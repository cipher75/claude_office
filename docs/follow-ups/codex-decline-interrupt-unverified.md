# 실제 Codex 거절 결과가 transcript의 실행 항목으로 남지 않음

**증상** — 현재 거절 복구는 `event_msg.item_completed.item.status=declined`를 읽는다. 실제 승인 요청을 거절한 시험에서는 이 항목이 기록 파일에 없어, 이 판독 경로만으로 거절을 알아낼 수 없었다.

**확인한 근거** — 2026-11-10 ChatGPT 앱 내장 Codex 0.167.0-alpha.3.2의 App Server로 사람 검토(`on-request`, `approvals_reviewer=user`)를 실행했다. `item/commandExecution/requestApproval`에 `decision=decline`을 응답했다. `item/completed` 알림은 `commandExecution`, `id=exec-b9a2abe4-5b59-4e05-9800-bb2640d17b87`, `status=declined`를 반환했다. 세션 `01a1c309-9e56-74e2-ae1e-3e25d712f3c8`의 기록에는 해당 CommandExecution item_completed가 없었다. 대신 `custom_tool_call_output`에 `exec_command failed: CreateProcess`와 `Rejected("rejected by user")`가 남았다. 바깥 코드 모드 호출 ID는 `call_c128a079034e4e9987cf96b0809871c2`로, 승인 요청의 exec ID와 달랐다. 대화형 TUI 시험은 허용 창까지 확인했으나 자동 입력으로 거절 완료를 확인하지 못했다.

**추정 원인** — App Server의 실행 항목 알림과 rollout에 저장되는 항목의 범위가 다르다. 코드 모드의 바깥 호출 결과만으로 내부 실행 ID를 연결할 수 있는지도 확인이 필요하다.

**시도한 조치** — 실제 대화형 Esc는 별도로 확인했다. 세션 `01a1c302-2dcb-7db2-ba0b-3d9e11fb225c`에서 명령 실행 약 1.1초 뒤 Esc를 입력했으며 Interrupt hook이 왔다. 명령은 백그라운드에서 계속 실행돼 약 6.8초 뒤 completed로 기록됐다. 중단 뒤 completed도 완료 표정으로 바뀌는 문제를 수정하고 동일 조건의 실제 시험에서 cancelled 유지, inTurn=false, doneCount=1을 확인했다. 시험 실행에만 검토한 hook 신뢰 우회 옵션을 사용했으며 사용자 설정의 신뢰 등록은 추가하지 않았다.

**다음 확인** — 실제 거절 결과를 hook 수집 경로와 연결할 공식 신호를 확인한다. App Server 알림을 관찰하는 방식과 기록의 거절 증거를 실제 내부 호출에 안전하게 연결하는 방식을 비교한다. 동일 턴의 병렬 호출과 코드 모드의 여러 내부 호출을 함께 확인해야 한다. 거절 항목이 항상 transcript에 저장된다는 전제로 완료 판정을 내리지 않는다.
