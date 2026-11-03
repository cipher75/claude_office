# sub-agent의 허용 거절·중단 결과를 바로 받지 못함

sub-agent transcript는 지켜보지 않아, 사용자가 sub-agent의 허용을 거절하거나 중단해도 바로 알 수 없다. 지금은 포그라운드 sub-agent의 `?`는 본 세션의 턴이 끝날 때, 백그라운드 sub-agent의 `?`는 그 sub-agent가 끝날 때(`TranscriptTaskFinished`) 중단됨으로 정리한다. 그래서 거절 뒤 `?`가 그 시점까지 회의실에 남는다. sub-agent transcript를 해당 호출과 이어 읽으면 바로 거둘 수 있다(2026-11-03).
