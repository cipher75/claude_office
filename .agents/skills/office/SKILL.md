---
name: office
description: 이 세션의 tool, skill, sub-agent 활동을 로컬 웹 화면(사무실 속 캐릭터)에 연결한다. 사용자가 사무실 화면에 연결하거나(`/office`) 연결을 끊어 달라고(`/office close`) 할 때만 사용한다.
argument-hint: "[close]"
allowed-tools: Bash(sh */skills/office/connect.sh *)
hooks:
  UserPromptExpansion:
    - hooks:
        - type: http
          url: http://127.0.0.1:4747/api/events
          timeout: 5
  UserPromptSubmit:
    - hooks:
        - type: http
          url: http://127.0.0.1:4747/api/events
          timeout: 5
  PreToolUse:
    - matcher: "*"
      hooks:
        - type: http
          url: http://127.0.0.1:4747/api/events
          timeout: 5
  Notification:
    - hooks:
        - type: http
          url: http://127.0.0.1:4747/api/events
          timeout: 5
  SubagentStart:
    - hooks:
        - type: http
          url: http://127.0.0.1:4747/api/events
          timeout: 5
  SubagentStop:
    - hooks:
        - type: http
          url: http://127.0.0.1:4747/api/events
          timeout: 5
  Stop:
    - hooks:
        - type: http
          url: http://127.0.0.1:4747/api/events
          timeout: 5
  SessionEnd:
    - hooks:
        - type: http
          url: http://127.0.0.1:4747/api/events
          timeout: 5
---

# 사무실 화면 연결

이 세션을 사무실 화면에 연결합니다. `/office close`로 실행하면 연결을 끊습니다. 이 스킬을 실행한 뒤부터 이 세션에서 일어나는 tool, skill, sub-agent 호출이 http://127.0.0.1:4747 의 사무실 화면에 캐릭터로 나타납니다. hook은 이 PC의 로컬 서버로만 보냅니다. 호스팅을 설정했다면 로컬 서버가 도구 이름, 파일 이름 같은 줄인 상태만 호스팅으로 올립니다.

연결 신호 전송 결과: !`sh ${CLAUDE_SKILL_DIR}/connect.sh ${CLAUDE_SESSION_ID} $ARGUMENTS`

결과가 `{}`이면 성공한 것입니다. "연결 실패"가 보이면 그 내용을 사용자에게 그대로 알려 주세요. 다른 작업은 하지 않고 한 줄로만 답합니다.

- 인자 없이 실행했으면: "사무실 화면에 연결했습니다. http://127.0.0.1:4747"
- `close`로 실행했으면: "사무실 화면에서 이 세션의 연결을 끊었습니다. 다시 연결하려면 /office 를 실행하세요."

연결을 끊어도 이 세션에 걸린 hook은 계속 이벤트를 보내지만, 사무실 서버는 다시 `/office`로 연결하기 전까지 이 세션의 이벤트를 반영하지 않습니다.
