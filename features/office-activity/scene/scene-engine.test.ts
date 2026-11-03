import { describe, expect, test } from "vitest";

import { BOSS_SEAT, DOOR, NO_GO, REPORT_SPOTS, SLOTS } from "./layout";
import { SceneEngine, type SceneCharacter } from "./scene-engine";

const work = (id: string, label = `Read · ${id}`): SceneCharacter => ({
  id, kind: "tool", status: "working", label,
});
const waiting = (id: string): SceneCharacter => ({ ...work(id), status: "waiting" });
const denied = (id: string): SceneCharacter => ({ ...work(id), status: "denied" });
const approved = (id: string): SceneCharacter => ({ ...work(id), status: "approved" });

// 난수를 순환하는 고정 수열로 바꿔 움직임을 예측할 수 있게 한다.
// 빈 사무실을 한 번 맞춰 두어, 이후 들어오는 캐릭터가 새 호출로 다뤄지게 한다.
function engine() {
  let n = 0;
  const e = new SceneEngine(() => (n = (n + 0.21) % 1));
  e.sync([], false);
  return e;
}

function run(e: SceneEngine, seconds: number) {
  for (let i = 0; i < seconds * 20; i++) e.step(0.05);
}

function walker(e: SceneEngine, id: string) {
  const w = e.walkers.find((x) => x.id === id);
  if (!w) throw new Error(`walker ${id} not found`);
  return w;
}

describe("수행 중", () => {
  test("새 호출은 출입문에서 나타나 사무실 안쪽으로 걸어 들어간다", () => {
    const e = engine();
    e.sync([work("a")], true);

    expect(walker(e, "a")).toMatchObject({ x: DOOR.x, y: DOOR.y, bubble: "work", label: "Read · a" });
    run(e, 1);
    expect(walker(e, "a").y).toBeLessThan(DOOR.y);
    expect(walker(e, "a").moving).toBe(true);
  });

  test("일하는 캐릭터는 가만히 서 있지 않고 계속 돌아다닌다", () => {
    const e = engine();
    e.sync([work("a")], true);
    run(e, 8);
    const first = { x: walker(e, "a").x, y: walker(e, "a").y };

    let moved = false;
    for (let i = 0; i < 400 && !moved; i++) {
      e.step(0.05);
      moved = walker(e, "a").moving && (walker(e, "a").x !== first.x || walker(e, "a").y !== first.y);
    }
    expect(moved).toBe(true);
  });

  test("호출이 끝나 목록에서 빠진 캐릭터는 출입문으로 나가 사라진다", () => {
    const e = engine();
    e.sync([work("a")], true);
    run(e, 6);

    e.sync([], true);
    run(e, 15);

    expect(e.walkers).toEqual([]);
  });

  test("짧게 끝난 호출도 바로 나가지 않고 3초쯤 더 돌아다니다 나간다", () => {
    const e = engine();
    e.sync([work("a")], true);
    e.step(0.05);
    e.sync([], true);

    run(e, 2.5);
    expect(walker(e, "a")).toMatchObject({ fading: false, bubble: "work" });
    expect(walker(e, "a").y).toBeLessThan(DOOR.y);

    run(e, 15);
    expect(e.walkers).toEqual([]);
  });
});

describe("허용 대기", () => {
  test("허용 대기 캐릭터는 회의실 자리로 가서 멈추고 의아한 표정으로 ? 말풍선을 띄운다", () => {
    const e = engine();
    e.sync([work("a")], true);
    run(e, 5);
    e.sync([waiting("a")], true);
    run(e, 12);

    expect(walker(e, "a")).toMatchObject({
      x: SLOTS[0].x, y: SLOTS[0].y, bubble: "ask", expr: "confused", moving: false,
    });
  });

  test("허용 대기 캐릭터가 여럿이면 서로 다른 자리에 선다", () => {
    const e = engine();
    e.sync([waiting("a"), waiting("b")], true);
    run(e, 15);

    const spots = new Set(e.walkers.map((w) => `${w.x},${w.y}`));
    expect(spots.size).toBe(2);
  });

  test("다시 일하는 상태가 되면 회의실에서 나와 돌아다닌다", () => {
    const e = engine();
    e.sync([waiting("a")], true);
    run(e, 15);

    e.sync([work("a")], true);
    run(e, 2);

    expect(walker(e, "a")).toMatchObject({ bubble: "work", expr: "happy", moving: true });
  });
});

describe("허용 후 완료", () => {
  test("서버가 허용됨으로 정한 캐릭터는 밝은 표정으로 바뀐 뒤 출입문으로 나간다", () => {
    const e = engine();
    e.sync([waiting("a")], true);
    run(e, 15);

    e.sync([approved("a")], true);
    expect(walker(e, "a")).toMatchObject({ expr: "happy", bubble: "glad", moving: false });
    run(e, 3);
    expect(walker(e, "a").x).toBeLessThan(SLOTS[0].x);

    run(e, 15);
    expect(e.walkers).toEqual([]);
  });

  test("허용 여부를 모른 채 목록에서 빠진 허용 대기 캐릭터는 허용됨을 띄우지 않고 ?만 지운 채 나간다", () => {
    const e = engine();
    e.sync([waiting("a")], true);
    run(e, 15);

    e.sync([], true);
    expect(walker(e, "a")).toMatchObject({ expr: "happy", bubble: "work", moving: true });
  });
});

describe("거절이 아닌 중단", () => {
  test("중단된 캐릭터는 담담한 표정으로 잠깐 멈췄다가 출입문으로 나간다", () => {
    const e = engine();
    e.sync([waiting("a")], true);
    run(e, 15);

    e.sync([{ ...work("a"), status: "cancelled" }], true);
    expect(walker(e, "a")).toMatchObject({ expr: "plain", bubble: "stop", moving: false });
    run(e, 3);
    expect(walker(e, "a").x).toBeLessThan(SLOTS[0].x);

    run(e, 15);
    expect(e.walkers).toEqual([]);
  });
});

describe("장면을 처음 맞출 때", () => {
  test("이미 있던 캐릭터는 출입문으로 들어오지 않고 제자리에 바로 선다", () => {
    const e = new SceneEngine(() => 0.5);
    e.sync([waiting("a"), work("b")], true);

    expect(walker(e, "a")).toMatchObject({ x: SLOTS[0].x, y: SLOTS[0].y, moving: false, bubble: "ask" });
    expect(walker(e, "b")).toMatchObject({ moving: false });
    expect(walker(e, "b").y).not.toBe(DOOR.y);
  });
});

describe("허용 거절", () => {
  test("거절된 캐릭터는 슬픈 표정으로 회의실에서 나와 출입문으로 퇴근한다", () => {
    const e = engine();
    e.sync([waiting("a")], true);
    run(e, 15);

    e.sync([denied("a")], true);
    expect(walker(e, "a")).toMatchObject({ expr: "sad", bubble: "sad" });
    run(e, 3);
    expect(walker(e, "a").x).toBeLessThan(SLOTS[0].x);

    run(e, 15);
    expect(e.walkers).toEqual([]);
  });

  test("퇴근한 캐릭터는 서버 목록에 거절 상태로 남아 있어도 다시 나타나지 않는다", () => {
    const e = engine();
    e.sync([waiting("a")], true);
    run(e, 15);
    e.sync([denied("a")], true);
    run(e, 20);

    e.sync([denied("a")], true);
    expect(e.walkers).toEqual([]);
  });
});

describe("사무실 불", () => {
  test("서버가 불을 켜면 바로 켜진다", () => {
    const e = engine();
    e.sync([], true);
    e.step(0.05);

    expect(e.lit).toBe(true);
  });

  test("캐릭터가 모두 나가고 서버도 불을 끄면 보스까지 퇴근한 뒤 잠시 뒤에 꺼진다", () => {
    const e = engine();
    e.sync([work("a")], true);
    run(e, 5);
    e.sync([], false);
    run(e, 15);
    expect(e.walkers).toEqual([]);

    run(e, 10);
    expect(e.boss).toBeNull();
    expect(e.lit).toBe(false);
  });

  test("캐릭터가 사무실에 남아 있으면 서버가 불을 꺼도 켜져 있다", () => {
    const e = engine();
    e.sync([work("a")], true);
    run(e, 5);
    e.sync([work("a")], false);
    run(e, 5);

    expect(e.lit).toBe(true);
  });

  test("꺼진 뒤 새 호출이 들어오면 다시 켜진다", () => {
    const e = engine();
    e.sync([], false);
    run(e, 3);
    expect(e.lit).toBe(false);

    e.sync([work("a")], true);
    e.step(0.05);
    expect(e.lit).toBe(true);
  });
});

describe("일을 마친 직원의 결재", () => {
  test("목록에서 빠진 직원은 3초쯤 더 돌아다닌 뒤 보스 책상 옆 결재 자리에 잠시 섰다가 출입문으로 나간다", () => {
    const e = engine();
    e.sync([work("a")], true);
    run(e, 6);
    e.sync([], true);
    run(e, 2.5);
    expect(walker(e, "a").bubble).toBe("work");
    run(e, 1);
    expect(walker(e, "a").bubble).toBe("done");

    let reported = false;
    for (let i = 0; i < 300 && !reported; i++) {
      e.step(0.05);
      const w = e.walkers.find((x) => x.id === "a");
      reported = Boolean(w && !w.moving && REPORT_SPOTS.some((p) => p.x === w.x && p.y === w.y));
    }
    expect(reported).toBe(true);
    expect(walker(e, "a").flip).toBe(1);
    expect(e.boss?.pose).toBe("approve");

    run(e, 15);
    expect(e.walkers).toEqual([]);
  });

  test("결재 자리가 모두 차면 남은 직원은 겹쳐 서지 않고 자리가 빌 때까지 기다린다", () => {
    const e = engine();
    const ids = ["a", "b", "c", "d"];
    e.sync(ids.map((id) => work(id)), true);
    run(e, 6);
    e.sync([], true);

    let reportedD = false;
    for (let i = 0; i < 600; i++) {
      e.step(0.05);
      const standing = e.walkers.filter((w) => !w.moving && REPORT_SPOTS.some((p) => p.x === w.x && p.y === w.y));
      const spots = new Set(standing.map((w) => `${w.x},${w.y}`));
      expect(spots.size).toBe(standing.length);
      if (standing.some((w) => w.id === "d")) reportedD = true;
    }
    expect(reportedD).toBe(true);
    expect(e.walkers).toEqual([]);
  });

  test("거절된 직원은 결재 없이 바로 나간다", () => {
    const e = engine();
    e.sync([waiting("a")], true);
    run(e, 15);
    e.sync([denied("a")], true);

    for (let i = 0; i < 400; i++) {
      e.step(0.05);
      const w = e.walkers.find((x) => x.id === "a");
      if (!w) break;
      expect(REPORT_SPOTS.some((p) => p.x === w.x && p.y === w.y)).toBe(false);
    }
  });
});

describe("보스", () => {
  test("첫 업무 전에는 보스가 없고, 불이 켜지면 자기 책상에 앉아 혼자 무언가를 쓴다", () => {
    const e = engine();
    expect(e.boss).toBeNull();

    e.sync([], true);
    expect(e.boss).toMatchObject({ x: BOSS_SEAT.x, y: BOSS_SEAT.y, seated: true, pose: "write" });
  });

  test("직원이 일하는 동안 생각하고, 허용 대기가 생기면 회의실을 보며 의아해한다", () => {
    const e = engine();
    e.sync([work("a")], true);
    expect(e.boss?.pose).toBe("think");

    e.sync([work("a"), waiting("b")], true);
    expect(e.boss?.pose).toBe("confused");
  });

  test("모두 끝나면 보스가 일어나 출입문으로 나가고, 그동안은 불이 켜져 있다", () => {
    const e = engine();
    e.sync([], true);
    e.sync([], false);
    run(e, 1);

    expect(e.boss).toMatchObject({ seated: false, moving: true });
    expect(e.lit).toBe(true);
    run(e, 10);
    expect(e.boss).toBeNull();
    expect(e.lit).toBe(false);
  });

  test("퇴근하던 보스는 새 업무가 들어오면 순간이동하지 않고 걸어서 자리로 돌아온다", () => {
    const e = engine();
    e.sync([], true);
    e.sync([], false);
    run(e, 2);
    const away = { x: e.boss!.x, y: e.boss!.y };

    e.sync([work("a")], true);
    e.step(0.05);
    expect(e.boss).toMatchObject({ seated: false, moving: true });
    expect(Math.hypot(e.boss!.x - away.x, e.boss!.y - away.y)).toBeLessThan(3);

    run(e, 8);
    expect(e.boss).toMatchObject({ x: BOSS_SEAT.x, y: BOSS_SEAT.y, seated: true, pose: "think" });
  });
});

describe("혼자 쓰는 보스와 비서", () => {
  // 비서가 나타날 때까지 진행하고 걸린 시간(초)을 돌려준다. 오지 않으면 Infinity.
  function untilSecretary(e: SceneEngine, limit: number): number {
    for (let i = 0; i < limit * 20; i++) {
      if (e.secretary) return i / 20;
      e.step(0.05);
    }
    return Infinity;
  }

  test("직원 없이 턴이 진행 중이면 연필을 놀리며 쓰고, 가끔 두 팔을 들고 종이를 한 움큼 흩뿌린다", () => {
    const e = engine();
    e.sync([], true);
    const frame = e.boss!.frame;
    let tossed = 0;
    let cheered = false;
    const seen = new Set<number>();
    for (let i = 0; i < 20 * 20; i++) {
      e.step(0.05);
      if (e.boss?.cheering) cheered = true;
      for (const p of e.papers) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        tossed++;
      }
    }

    expect(e.boss!.frame).toBeGreaterThan(frame);
    expect(cheered).toBe(true);
    // 20초 동안 4.5–7.5초 간격으로 2–4번, 한 번에 6–8장을 흩뿌린다.
    expect(tossed).toBeGreaterThanOrEqual(12);
    expect(tossed).toBeLessThanOrEqual(32);
  });

  test("연결만 되고 턴이 진행 중이 아니면 담담히 앉아 기다리고, 종이도 비서도 없다", () => {
    const e = engine();
    e.sync([], true, false);
    run(e, 60);

    expect(e.boss).toMatchObject({ seated: true, pose: "plain" });
    expect(e.papers).toEqual([]);
    expect(e.secretary).toBeNull();

    e.sync([], true, true);
    expect(e.boss?.pose).toBe("write");
  });

  test("직원이 일하는 동안에는 쓰지 않고 생각하며, 종이도 던지지 않는다", () => {
    const e = engine();
    e.sync([work("a")], true);
    run(e, 10);

    expect(e.boss?.pose).toBe("think");
    expect(e.papers).toEqual([]);
  });

  test("짧게 혼자 쓸 때는 비서가 오지 않고, 오래 쓰면 커피를 가져와 책상에 두고 돌아간다", () => {
    const e = engine();
    e.sync([], true);
    // 쉬지 않고 25–40초를 써야 온다.
    expect(untilSecretary(e, 60)).toBeGreaterThanOrEqual(25);
    expect(e.secretary).toMatchObject({ carrying: true });
    let served = false;
    for (let i = 0; i < 40 * 20 && e.secretary; i++) {
      e.step(0.05);
      if (e.secretary?.serving) served = true;
    }

    expect(served).toBe(true);
    expect(e.secretary).toBeNull();
    expect(e.coffee).toBe(true);
  });

  test("비서는 한 번 온 뒤 3분 안에는 다시 오지 않는다", () => {
    const e = engine();
    e.sync([], true);
    let visits = 0;
    let present = false;
    for (let i = 0; i < 170 * 20; i++) {
      e.step(0.05);
      if (e.secretary && !present) visits++;
      present = e.secretary !== null;
    }

    expect(visits).toBe(1);
  });

  test("직원이 드나들어 혼자 쓰는 시간이 끊기면 비서는 오지 않는다", () => {
    const e = engine();
    e.sync([], true);
    for (let round = 0; round < 6; round++) {
      run(e, 15);
      e.sync([work(`w${round}`)], true);
      e.step(0.05);
      e.sync([], true);
    }

    expect(e.secretary).toBeNull();
  });

  test("비서가 커피를 건네는 중에도 직원의 결재와 보스의 수고했어요는 그대로 일어난다", () => {
    const e = engine();
    e.sync([], true);
    untilSecretary(e, 60);
    while (e.secretary && !e.secretary.serving) e.step(0.05);
    expect(e.secretary?.serving).toBe(true);

    e.sync([approved("a")], true);
    let approvedPose = false;
    for (let i = 0; i < 20 * 20; i++) {
      e.step(0.05);
      if (e.boss?.pose === "approve") approvedPose = true;
    }

    expect(approvedPose).toBe(true);
  });

  test("턴이 끝나면 비서도 돌아가고 커피를 치우며, 비서까지 나간 뒤에 불이 꺼진다", () => {
    const e = engine();
    e.sync([], true);
    untilSecretary(e, 60);
    run(e, 2);
    expect(e.secretary).not.toBeNull();

    e.sync([], false);
    run(e, 1);
    expect(e.coffee).toBe(false);
    for (let i = 0; i < 30 * 20 && e.secretary; i++) {
      e.step(0.05);
      if (e.secretary) expect(e.lit).toBe(true);
    }
    expect(e.secretary).toBeNull();
    run(e, 15);
    expect(e.lit).toBe(false);
  });
});

describe("보스 구역", () => {
  test("직원은 일하고, 기다리고, 결재받고, 퇴근하는 내내 보스 구역에 발을 들이지 않는다", () => {
    const e = engine();
    const inside = (w: { x: number; y: number }) =>
      w.x > NO_GO.x0 + 0.01 && w.x < NO_GO.x1 - 0.01 && w.y > NO_GO.y0 + 0.01 && w.y < NO_GO.y1 - 0.01;
    const check = (seconds: number) => {
      for (let i = 0; i < seconds * 20; i++) {
        e.step(0.05);
        for (const w of e.walkers) expect(inside(w), `${w.id} at ${w.x},${w.y}`).toBe(false);
      }
    };
    e.sync([work("a"), work("b"), work("c")], true);
    check(30);
    e.sync([waiting("a"), work("b"), work("c")], true);
    check(15);
    e.sync([approved("a"), work("b")], true);
    check(15);
    e.sync([], false);
    check(20);
  });
});
