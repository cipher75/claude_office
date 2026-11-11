#!/bin/sh
# 이 세션의 연결·해제 신호를 사무실 서버로 보낸다.
# 스킬의 셸 명령에 명령 치환을 넣지 않아야 허용 목록 규칙만으로 확인 창 없이 실행된다.
# 사용법: sh connect.sh <세션 id> [close]
event=OfficeConnect
[ "$2" = close ] && event=OfficeDisconnect
project=$(basename "$PWD")
curl -s -m 2 -X POST -H "content-type: application/json" \
  -d "{\"hook_event_name\":\"$event\",\"session_id\":\"$1\",\"project\":\"$project\",\"cwd\":\"$PWD\"}" \
  http://127.0.0.1:4747/api/events \
  || echo "연결 실패: 사무실 서버가 꺼져 있습니다. 프로젝트에서 bun run office 로 켜 주세요."
