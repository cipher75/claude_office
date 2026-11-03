# 게시판이 CLI의 TaskCreate/TaskUpdate 목록을 읽지 못함

게시판의 task 목록은 데스크톱 앱의 `mcp__ccd_turn__update_plan`·`mcp__ccd_turn__wrap_up`과 CLI의 `TodoWrite` 입력만 읽는다. 최근 Claude Code CLI의 `TaskCreate`/`TaskUpdate`는 항목 id가 응답에만 있어 입력만으로는 목록을 만들 수 없고, 사무실 원본 이벤트(`/api/events`)와 로컬 transcript에서도 실제 호출 기록을 찾지 못해 형식을 확인하지 못했다. 실제 호출의 `tool_input`·`tool_response`를 모으면 `features/office-activity/task-plan.ts`에 더할 수 있다(2026-11-03).
