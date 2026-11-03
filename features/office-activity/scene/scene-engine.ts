import type { CharacterKind, CharacterStatus } from "../types";
import {
  BOSS_EXIT, BOSS_HAND, BOSS_SEAT, DOOR, DOOR_OUTSIDE, REPORT_SPOTS, SECRETARY_GATE, SECRETARY_SPOT, SLOTS, WALK_SPEED, WAYPOINTS, type Point,
} from "./layout";
import { route } from "./route";

// 서버가 알려 준 캐릭터 목록을 화면 속 움직임으로 옮기는 엔진. DOM과 canvas를 모른다.

export type SceneCharacter = {
  id: string;
  kind: CharacterKind;
  status: CharacterStatus;
  label: string;
};

export type Expression = "happy" | "confused" | "sad" | "plain";
export type BubbleStyle = "work" | "ask" | "sad" | "glad" | "stop" | "done";

export type Walker = {
  id: string;
  kind: CharacterKind;
  label: string;
  x: number;
  y: number;
  flip: 1 | -1;
  expr: Expression;
  bubble: BubbleStyle;
  frame: number;
  moving: boolean;
  fading: boolean;
  // 보스 책상 옆에서 결재받는 중. 말풍선이 보스를 가리지 않게 보스 반대쪽으로 펼친다.
  reporting: boolean;
};

// 보스의 모습: 직원이 일하는 동안 생각에 잠기고(think), 결재할 때 도장을 들고(approve),
// 허용 대기가 생기면 회의실을 보며 의아해한다(confused). 직원이 없는데 턴이 진행 중이면 Claude가 혼자
// 생각하거나 답을 쓰는 중이므로 종이에 무언가를 적는다(write). 턴이 끝나 퇴근할 때는 담담하다(plain).
export type BossPose = "think" | "write" | "approve" | "confused" | "plain";

// 보스가 "유레카!" 하며 흩뿌린 종이 한 장. 손에서 (dx, dy)만큼 솟구쳤다가 fall만큼 떨어지며 spin도 돈다.
// 화면이 날아가는 모습을 그리고, 엔진은 수명이 다하면 지운다.
export type Paper = { id: number; x: number; y: number; dx: number; dy: number; fall: number; spin: number; delay: number };

// 보스가 오래 혼자 쓰고 있으면 가끔 커피를 가져다주는 비서.
export type Secretary = {
  x: number;
  y: number;
  flip: 1 | -1;
  frame: number;
  moving: boolean;
  fading: boolean;
  // 커피를 들고 있는지. 건네고 나면 빈손으로 돌아간다.
  carrying: boolean;
  // 보스 옆에서 커피를 건네는 중.
  serving: boolean;
};

export type Boss = {
  x: number;
  y: number;
  seated: boolean;
  pose: BossPose;
  flip: 1 | -1;
  frame: number;
  moving: boolean;
  fading: boolean;
  // 혼자 쓰다가 한 묶음을 다 써서 두 팔을 번쩍 들고 종이를 흩뿌리는 중.
  cheering: boolean;
};

type Phase = "to-work" | "idle" | "to-wait" | "waiting" | "sad" | "glad" | "stop" | "to-report" | "reporting" | "leaving";

type Mover = {
  x: number;
  y: number;
  flip: 1 | -1;
  frame: number;
  moving: boolean;
  path: Point[];
  frameTime: number;
};

type Internal = Walker &
  Mover & {
    phase: Phase;
    pause: number;
    slot: number;
    spot: number;
    fadeTime: number;
    // 일을 마친 뒤 사무실을 더 돌아다닐 남은 시간(초). 음수면 아직 일하는 중이다.
    linger: number;
  };

type BossState = Boss & Mover & { phase: "seated" | "leaving" | "returning" | "gone"; fadeTime: number };
type SecretaryState = Secretary & Mover & { phase: "to-boss" | "serving" | "leaving"; pause: number; fadeTime: number };

const LIGHTS_OFF_DELAY = 1.5;
const FADE_OUT = 0.4;
const SAD_PAUSE = 1.2;
const GLAD_PAUSE = 1.2;
const STOP_PAUSE = 1.2;
const REPORT_PAUSE = 1.4;
const REPORT_RETRY = 0.5;
const FRAME_TIME = 0.17;
// 일을 마친 캐릭터가 바로 나가지 않고 더 돌아다니는 시간. 짧은 호출도 화면에서 볼 수 있게 한다.
const LINGER = 3;
// 한 묶음을 다 쓰고 종이를 흩뿌리는 간격(초). 최소값에 난수를 더한다.
const PAPER_EVERY = 4.5;
const PAPER_JITTER = 3;
// 한 번에 흩뿌리는 종이 장수와, 팔을 들고 있는 시간.
const BURST_MIN = 6;
const BURST_JITTER = 3;
const CHEER_TIME = 0.9;
// 화면이 날아가는 종이를 보여주는 시간. 화면의 애니메이션 길이(지연 포함)보다 조금 길다.
export const PAPER_LIFE = 1.9;
// 보스가 연필을 움직이는 간격.
const WRITE_FRAME_TIME = 0.13;
// 비서는 보스가 쉬지 않고 이만큼(초) 혼자 쓴 뒤에야 오고, 한 번 온 뒤에는 COFFEE_COOLDOWN 동안 오지 않는다.
// 자주 오면 산만하므로 짧은 생각에는 오지 않게 했다.
const COFFEE_AFTER = 25;
const COFFEE_JITTER = 15;
const COFFEE_COOLDOWN = 180;
const SERVE_PAUSE = 2.2;

export class SceneEngine {
  private items: Internal[] = [];
  private departed = new Set<string>();
  private serverLit = false;
  private emptyTime = 0;
  private synced = false;
  private chief: BossState = {
    x: BOSS_SEAT.x,
    y: BOSS_SEAT.y,
    seated: true,
    pose: "plain",
    flip: 1,
    frame: 0,
    moving: false,
    fading: false,
    cheering: false,
    path: [],
    frameTime: 0,
    phase: "gone",
    fadeTime: 0,
  };
  private paperList: (Paper & { age: number })[] = [];
  private paperId = 0;
  private nextPaper = PAPER_EVERY;
  private cheerTime = 0;
  private writeFrameTime = 0;
  // 보스가 쉬지 않고 혼자 쓴 시간, 마지막 커피 뒤로 지난 시간, 이번에 커피가 올 때까지 쓸 시간.
  private writeStreak = 0;
  private sinceCoffee = COFFEE_COOLDOWN;
  private coffeeAfter: number;
  private helper: SecretaryState | null = null;
  // 비서가 책상에 내려놓은 커피. 보스가 퇴근할 때 치운다.
  coffee = false;
  lit = false;

  constructor(private readonly rng: () => number = Math.random) {
    this.coffeeAfter = COFFEE_AFTER + rng() * COFFEE_JITTER;
  }

  get papers(): Paper[] {
    return this.paperList;
  }

  get secretary(): Secretary | null {
    return this.helper;
  }

  get walkers(): Walker[] {
    return this.items;
  }

  // 사무실에 보스가 없으면(첫 업무 전, 퇴근 뒤) null.
  get boss(): Boss | null {
    return this.chief.phase === "gone" ? null : this.chief;
  }

  sync(characters: SceneCharacter[], serverLit: boolean): void {
    this.serverLit = serverLit;
    // 장면을 처음 맞출 때 이미 있던 캐릭터는 새로 들어온 것이 아니므로 제자리에 바로 세운다.
    const placed = !this.synced;
    this.synced = true;
    const ids = new Set(characters.map((c) => c.id));
    this.departed.forEach((id) => {
      if (!ids.has(id)) this.departed.delete(id);
    });

    for (const character of characters) {
      if (this.departed.has(character.id)) continue;
      const walker = this.items.find((w) => w.id === character.id);
      if (walker) {
        walker.linger = -1;
        this.update(walker, character);
      }
      else this.spawn(character, placed);
    }
    for (const walker of this.items) {
      if (!ids.has(walker.id)) this.finish(walker);
    }
    if (serverLit || this.items.length > 0) this.turnOn();
    this.chief.pose = this.bossPose();
  }

  step(dt: number): void {
    for (const w of [...this.items]) this.advance(w, dt);

    if (this.serverLit || this.items.length > 0) this.turnOn();
    else if (this.chief.phase === "seated") this.bossLeaves();
    this.advanceBoss(dt);
    this.chief.pose = this.bossPose();
    this.advanceWriting(dt);
    this.advanceSecretary(dt);
    // 보스와 비서까지 퇴근한 뒤에 불이 꺼진다.
    if (!this.lit || this.chief.phase !== "gone" || this.helper) return;
    this.emptyTime += dt;
    if (this.emptyTime >= LIGHTS_OFF_DELAY) this.lit = false;
  }

  private turnOn() {
    this.lit = true;
    this.emptyTime = 0;
    const b = this.chief;
    // 퇴근하던 보스는 왔던 길을 되짚어 걸어서 자리로 돌아간다.
    if (b.phase === "leaving" && !b.fading) {
      const exit = BOSS_EXIT[BOSS_EXIT.length - 1];
      b.path = [...route(b, exit), ...BOSS_EXIT.slice(0, -1).reverse(), BOSS_SEAT];
      b.phase = "returning";
      b.moving = true;
    } else if (b.phase === "gone" || b.phase === "leaving") {
      // 이미 문을 나섰거나 나서는 중이면 화면에 없으므로, 처음처럼 자리에 앉혀 둔다.
      Object.assign(b, { ...BOSS_SEAT, seated: true, moving: false, fading: false, path: [], phase: "seated", fadeTime: 0 });
    }
  }

  private bossLeaves() {
    const b = this.chief;
    this.coffee = false;
    if (this.helper && this.helper.phase !== "leaving") this.secretaryLeaves();
    b.seated = false;
    b.phase = "leaving";
    b.path = [...BOSS_EXIT, ...route(BOSS_EXIT[BOSS_EXIT.length - 1], DOOR_OUTSIDE)];
    b.moving = true;
  }

  private advanceBoss(dt: number) {
    const b = this.chief;
    if (b.phase === "returning") {
      if (this.move(b, dt)) Object.assign(b, { ...BOSS_SEAT, seated: true, flip: 1, phase: "seated" });
      return;
    }
    if (b.phase !== "leaving") return;
    if (b.fading) {
      b.fadeTime += dt;
      if (b.fadeTime >= FADE_OUT) b.phase = "gone";
      return;
    }
    if (this.move(b, dt)) b.fading = true;
  }

  private bossPose(): BossPose {
    const phases = new Set(this.items.map((w) => w.phase));
    if (phases.has("to-wait") || phases.has("waiting")) return "confused";
    if (phases.has("reporting")) return "approve";
    if (phases.has("to-work") || phases.has("idle") || phases.has("to-report")) return "think";
    // 직원이 없어도 서버가 불을 켜 두었으면 턴이 진행 중이다. Claude가 혼자 생각하거나 답을 쓰는 중이다.
    if (this.serverLit) return "write";
    return "plain";
  }

  // 앉아서 쓰는 동안 손을 움직이고, 가끔 다 쓴 종이를 뒤나 위로 던진다. 쉬지 않고 오래 쓰면 비서를 부른다.
  private advanceWriting(dt: number) {
    for (const p of this.paperList) p.age += dt;
    this.paperList = this.paperList.filter((p) => p.age < PAPER_LIFE);
    this.sinceCoffee += dt;
    const b = this.chief;
    const writing = b.phase === "seated" && b.pose === "write";
    if (!writing) {
      this.writeStreak = 0;
      this.nextPaper = PAPER_EVERY;
      this.cheerTime = 0;
      b.cheering = false;
      return;
    }
    this.writeStreak += dt;
    if (this.cheerTime > 0) {
      this.cheerTime -= dt;
      b.cheering = this.cheerTime > 0;
      return;
    }
    this.writeFrameTime += dt;
    if (this.writeFrameTime >= WRITE_FRAME_TIME) {
      this.writeFrameTime = 0;
      b.frame += 1;
    }
    this.nextPaper -= dt;
    if (this.nextPaper <= 0) {
      this.nextPaper = PAPER_EVERY + this.rng() * PAPER_JITTER;
      this.scatterPapers();
    }
    if (!this.helper && this.writeStreak >= this.coffeeAfter && this.sinceCoffee >= COFFEE_COOLDOWN) this.callSecretary();
  }

  // 유레카! 두 팔을 들고 종이 여러 장을 머리 위로 부채꼴로 흩뿌린다.
  private scatterPapers() {
    this.cheerTime = CHEER_TIME;
    this.chief.cheering = true;
    const count = BURST_MIN + Math.floor(this.rng() * BURST_JITTER);
    for (let i = 0; i < count; i++) {
      // 왼쪽 위(-160°)부터 오른쪽 위(-20°)까지 고르게 나누고 조금씩 흔든다.
      const angle = (-160 + (140 * (i + 0.5)) / count + (this.rng() - 0.5) * 14) * (Math.PI / 180);
      const reach = 24 + this.rng() * 22;
      this.paperList.push({
        id: ++this.paperId,
        ...BOSS_HAND,
        dx: Math.cos(angle) * reach,
        dy: Math.sin(angle) * reach,
        fall: 14 + this.rng() * 16,
        spin: (this.rng() < 0.5 ? -1 : 1) * (360 + this.rng() * 360),
        delay: this.rng() * 0.15,
        age: 0,
      });
    }
  }

  private callSecretary() {
    this.helper = {
      ...DOOR,
      flip: 1,
      frame: 0,
      moving: true,
      fading: false,
      carrying: true,
      serving: false,
      path: [...route(DOOR, SECRETARY_GATE), SECRETARY_SPOT],
      frameTime: 0,
      phase: "to-boss",
      pause: 0,
      fadeTime: 0,
    };
    this.sinceCoffee = 0;
    this.coffeeAfter = COFFEE_AFTER + this.rng() * COFFEE_JITTER;
  }

  private secretaryLeaves() {
    const s = this.helper;
    if (!s) return;
    s.serving = false;
    s.phase = "leaving";
    s.path = [SECRETARY_GATE, ...route(SECRETARY_GATE, DOOR_OUTSIDE)];
    s.moving = true;
  }

  private advanceSecretary(dt: number) {
    const s = this.helper;
    if (!s) return;
    if (s.phase === "serving") {
      s.pause -= dt;
      if (s.pause > 0) return;
      // 커피를 책상에 내려놓고 돌아간다.
      s.carrying = false;
      this.coffee = this.chief.phase === "seated";
      this.secretaryLeaves();
      return;
    }
    if (s.fading) {
      s.fadeTime += dt;
      if (s.fadeTime >= FADE_OUT) this.helper = null;
      return;
    }
    if (!this.move(s, dt)) return;
    if (s.phase === "leaving") s.fading = true;
    else {
      // 보스가 있는 왼쪽을 보고 커피를 건넨다.
      Object.assign(s, { phase: "serving", serving: true, flip: -1, pause: SERVE_PAUSE });
    }
  }

  private spawn(character: SceneCharacter, placed = false) {
    const walker: Internal = {
      id: character.id,
      kind: character.kind,
      label: character.label,
      x: DOOR.x,
      y: DOOR.y,
      flip: 1,
      expr: "happy",
      bubble: "work",
      frame: 0,
      moving: false,
      fading: false,
      reporting: false,
      phase: "to-work",
      path: [],
      pause: 0,
      slot: -1,
      spot: -1,
      frameTime: 0,
      fadeTime: 0,
      linger: -1,
    };
    this.items.push(walker);
    this.update(walker, character, true);
    if (placed && walker.moving) {
      const goal = walker.path[walker.path.length - 1];
      walker.x = goal.x;
      walker.y = goal.y;
      walker.path = [];
      walker.moving = false;
      this.arrive(walker);
    }
  }

  private update(w: Internal, c: SceneCharacter, isNew = false) {
    w.label = c.label;
    if (c.status === "waiting" && w.phase !== "to-wait" && w.phase !== "waiting") this.goWait(w);
    else if (c.status === "denied" && w.phase !== "sad" && w.phase !== "leaving") this.startSad(w);
    else if (c.status === "approved" && !["glad", "to-report", "reporting", "leaving"].includes(w.phase)) this.startGlad(w);
    else if (c.status === "cancelled" && w.phase !== "stop" && w.phase !== "leaving") this.startStop(w);
    else if (c.status === "working" && (isNew || w.phase === "to-wait" || w.phase === "waiting")) this.goWork(w);
  }

  // 서버 목록에서 빠진 캐릭터. 일하다 끝난 직원은 3초쯤 더 돌아다닌 뒤 보스에게 결재를 받고 나가고,
  // 허용 여부를 모른 채 빠진 허용 대기 캐릭터는 ?만 지우고 바로 나간다.
  private finish(w: Internal) {
    if (w.linger >= 0) return;
    if (w.phase === "to-work" || w.phase === "idle") w.linger = LINGER;
    else if (w.phase === "to-wait" || w.phase === "waiting") this.leave(w);
  }

  private goWork(w: Internal) {
    w.expr = "happy";
    w.bubble = "work";
    w.slot = -1;
    this.walkTo(w, this.pickWaypoint(w), "to-work");
  }

  private goWait(w: Internal) {
    w.expr = "confused";
    w.bubble = "ask";
    w.spot = -1;
    // 회의실 자리가 모두 차면 첫 자리에 겹쳐서라도 선다. ?가 보이지 않는 것보다 낫다.
    w.slot = Math.max(0, this.freeIndex(SLOTS.length, w, "slot"));
    this.walkTo(w, SLOTS[w.slot], "to-wait");
  }

  // 결재 자리로 간다. 자리가 모두 차 있으면 false를 돌려주고, 부른 쪽이 잠시 뒤 다시 시도한다.
  private goReport(w: Internal): boolean {
    w.expr = "happy";
    if (w.bubble !== "glad") w.bubble = "done";
    const spot = this.freeIndex(REPORT_SPOTS.length, w, "spot");
    if (spot < 0) return false;
    w.slot = -1;
    w.linger = -1;
    w.spot = spot;
    this.walkTo(w, REPORT_SPOTS[spot], "to-report");
    return true;
  }

  private startSad(w: Internal) {
    this.pauseWith(w, "sad", "sad", "sad", SAD_PAUSE);
  }

  // 거절은 아니지만 실행되지 않고 끝난 호출(중단, 만료 등). 담담한 표정으로 잠깐 멈췄다가 나간다.
  private startStop(w: Internal) {
    this.pauseWith(w, "stop", "plain", "stop", STOP_PAUSE);
  }

  private startGlad(w: Internal) {
    this.pauseWith(w, "glad", "happy", "glad", GLAD_PAUSE);
  }

  private pauseWith(w: Internal, phase: Phase, expr: Expression, bubble: BubbleStyle, pause: number) {
    w.expr = expr;
    w.bubble = bubble;
    w.slot = -1;
    w.spot = -1;
    w.reporting = false;
    w.moving = false;
    w.path = [];
    w.pause = pause;
    w.phase = phase;
  }

  private leave(w: Internal) {
    // 허용 여부를 모른 채 나가는 경우(세션 종료 등)에는 ?를 지우고 평소 모습으로 나간다.
    if (w.bubble === "ask") {
      w.expr = "happy";
      w.bubble = "work";
    }
    w.slot = -1;
    w.spot = -1;
    w.linger = -1;
    this.walkTo(w, DOOR_OUTSIDE, "leaving");
  }

  // 보스 구역을 돌아가는 길을 따라 걷는다.
  private walkTo(w: Internal, goal: Point, phase: Phase) {
    w.reporting = false;
    w.path = route(w, goal);
    w.phase = phase;
    w.moving = true;
  }

  private advance(w: Internal, dt: number) {
    if (w.linger >= 0) {
      w.linger -= dt;
      // 결재 자리가 비기를 기다리며 조금 더 돌아다닌다.
      if (w.linger < 0 && !this.goReport(w)) w.linger = REPORT_RETRY;
    }
    if (w.phase === "idle") {
      w.pause -= dt;
      if (w.pause <= 0) this.walkTo(w, this.pickWaypoint(w), "to-work");
    } else if (w.phase === "sad" || w.phase === "stop" || w.phase === "reporting") {
      w.pause -= dt;
      if (w.pause <= 0) this.leave(w);
    } else if (w.phase === "glad") {
      w.pause -= dt;
      if (w.pause <= 0 && !this.goReport(w)) w.pause = REPORT_RETRY;
    }
    if (!w.moving) {
      if (w.fading) this.fade(w, dt);
      return;
    }
    if (this.move(w, dt)) this.arrive(w);
  }

  // 길의 다음 지점으로 한 걸음 옮긴다. 마지막 지점에 닿으면 true.
  private move(m: Mover, dt: number): boolean {
    let stride = WALK_SPEED * dt;
    while (m.path.length > 0) {
      const next = m.path[0];
      const dx = next.x - m.x;
      const dy = next.y - m.y;
      const distance = Math.hypot(dx, dy);
      if (Math.abs(dx) > 1) m.flip = dx < 0 ? -1 : 1;
      if (distance > stride) {
        m.x += (dx / distance) * stride;
        m.y += (dy / distance) * stride;
        break;
      }
      m.x = next.x;
      m.y = next.y;
      stride -= distance;
      m.path.shift();
    }
    m.frameTime += dt;
    if (m.frameTime > FRAME_TIME) {
      m.frameTime = 0;
      m.frame += 1;
    }
    if (m.path.length > 0) return false;
    m.moving = false;
    return true;
  }

  private arrive(w: Internal) {
    if (w.phase === "to-work") {
      w.phase = "idle";
      w.pause = 1.4 + this.rng() * 2;
    } else if (w.phase === "to-wait") {
      w.phase = "waiting";
    } else if (w.phase === "to-report") {
      // 보스가 있는 오른쪽을 보고 선다.
      w.phase = "reporting";
      w.reporting = true;
      w.flip = 1;
      w.pause = REPORT_PAUSE;
    } else if (w.phase === "leaving") {
      w.fading = true;
      this.departed.add(w.id);
    }
  }

  private fade(w: Internal, dt: number) {
    w.fadeTime += dt;
    if (w.fadeTime >= FADE_OUT) this.items = this.items.filter((item) => item !== w);
  }

  private pickWaypoint(w: Internal): Point {
    const options = WAYPOINTS.filter((p) => Math.hypot(p.x - w.x, p.y - w.y) > 8);
    return options[Math.floor(this.rng() * options.length)];
  }

  // 다른 캐릭터가 쓰지 않는 자리 번호. 모두 차 있으면 -1.
  private freeIndex(count: number, w: Internal, key: "slot" | "spot"): number {
    const used = new Set(this.items.filter((o) => o !== w && o[key] >= 0).map((o) => o[key]));
    for (let i = 0; i < count; i++) if (!used.has(i)) return i;
    return -1;
  }
}
