// 사무실 장면의 논리 좌표(320 x 180). 화면 크기에 맞춰 비율로 확대한다.
export const SCENE_WIDTH = 320;
export const SCENE_HEIGHT = 180;

export type Point = { x: number; y: number };

// 캐릭터가 들어오고 나가는 출입문 앞(발 위치).
export const DOOR: Point = { x: 64, y: 176 };
export const DOOR_OUTSIDE: Point = { x: 64, y: 180 };

// 책상 네 개의 왼쪽 위 모서리. 배경과 조명이 함께 쓴다.
export const DESKS: Point[] = [
  { x: 28, y: 64 },
  { x: 88, y: 64 },
  { x: 28, y: 112 },
  { x: 88, y: 112 },
];

// 사무실 한가운데 보스 책상. top~panel은 상판(배경), panel~bottom은 보스를 가리는 앞판이다.
export const BOSS_DESK = { x: 151, top: 94, panel: 101, w: 60, bottom: 119 };
// 앉은 보스 스프라이트의 아래 끝(앞판 뒤에 가려진다).
export const BOSS_SEAT: Point = { x: 181, y: 105 };
// 퇴근하는 보스가 책상 뒤에서 일어나 책상 왼쪽으로 나오는 길.
export const BOSS_EXIT: Point[] = [
  { x: 181, y: 90 },
  { x: 132, y: 90 },
];

// 보스 구역: 책상·의자·보스와, 그 앞뒤로 직원의 몸이나 말풍선이 보스에 겹칠 수 있는 범위(발 위치 기준).
// 직원은 이 구역에 들어가지 않고 위쪽 통로(y ≤ 58)나 아래쪽 통로(y ≥ 160)로 돌아간다.
export const NO_GO = { x0: 137, x1: 225, y0: 59, y1: 159 };
// 구역 모서리 바깥의 돌아가는 지점.
export const DETOURS: Point[] = [
  { x: 132, y: 55 },
  { x: 132, y: 163 },
  { x: 230, y: 163 },
];

// 일을 마친 직원이 보스에게 결재를 받으며 잠시 서는 자리. 책상 왼쪽 바깥이다.
export const REPORT_SPOTS: Point[] = [
  { x: 133, y: 114 },
  { x: 133, y: 98 },
  { x: 120, y: 106 },
];

// 비서가 보스에게 커피를 건네며 서는 자리. 책상 오른쪽 끝, 회의실 벽 앞이다.
// 직원과 달리 보스 구역 안에 서므로, 구역 오른쪽 아래 모서리(SECRETARY_GATE)까지는 직원 길로 오고 거기서 곧장 올라온다.
export const SECRETARY_SPOT: Point = { x: 216, y: 104 };
export const SECRETARY_GATE: Point = { x: 230, y: 163 };
// 비서가 내려놓은 커피잔이 놓이는 보스 책상 위 자리(잔의 바닥).
export const COFFEE_ON_DESK: Point = { x: 203, y: 99 };
// 보스가 다 쓴 종이를 흩뿌리는 자리(머리 위로 든 두 손 사이).
export const BOSS_HAND: Point = { x: 181, y: 74 };

// 일하는 캐릭터가 머무는 지점들. 모두 보스 구역 바깥이다.
// 책상 바로 아래 통로는 말풍선이 책상을 가리므로 지나가기만 하고 머물지 않는다.
export const WAYPOINTS: Point[] = [
  { x: 52, y: 94 },
  { x: 112, y: 94 },
  { x: 52, y: 142 },
  { x: 112, y: 142 },
  { x: 128, y: 150 },
  { x: 180, y: 55 },
  { x: 126, y: 64 },
  { x: 100, y: 118 },
];

// 허용 대기 회의실에서 캐릭터가 서는 자리. 말풍선이 겹치지 않도록 멀리 떨어뜨렸다.
export const SLOTS: Point[] = [
  { x: 240, y: 128 },
  { x: 290, y: 128 },
  { x: 265, y: 148 },
  { x: 300, y: 148 },
  { x: 232, y: 148 },
  { x: 276, y: 120 },
  { x: 250, y: 120 },
];

export const WALK_SPEED = 34;
