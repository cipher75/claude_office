# 다른 사이트가 로컬 hook 수신 주소로 가짜 이벤트를 보낼 수 있음

`proxy.ts`는 Host만 확인하므로, 악성 페이지가 `text/plain`으로 `http://127.0.0.1:4747/api/events`에 POST하면 그대로 통과해 가짜 캐릭터가 생기고 호스팅으로도 중계될 수 있다(2026-11-02 `/code-review`). `Origin`이나 `Sec-Fetch-Site` 확인을 검토한다.
