"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { cn } from "cn";

import { SceneEngine, type Boss, type Paper, type SceneCharacter, type Secretary, type Walker } from "./scene-engine";
import { BOSS_HEIGHT, BOSS_WIDTH, drawBoss } from "./boss-sprite";
import { BOSS_DESK, COFFEE_ON_DESK } from "./layout";
import { BG_HEIGHT, BG_WIDTH, drawDeskFront, drawOffice } from "./office-background";
import { brightnessAt } from "./lighting";
import styles from "./office-scene.module.css";
import { SECRETARY_HEIGHT, SECRETARY_WIDTH, drawSecretary } from "./secretary-sprite";
import { KIND_STYLE, SPRITE_HEIGHT, SPRITE_WIDTH, drawSprite, lookFor } from "./sprite";

type OfficeSceneProps = {
  characters: SceneCharacter[];
  lit: boolean;
  // 턴이 진행 중인지. 직원이 없어도 진행 중이면 보스가 혼자 쓴다.
  working: boolean;
  // 한 번이라도 일이 끝난 세션인지에 따라 불이 꺼진 이유를 다르게 안내한다.
  hadWork: boolean;
  connected: boolean;
  // 장면이 지금 상태를 보여준다고 믿을 수 없을 때의 경고. 다른 안내보다 먼저, 캐릭터가 있어도 보여준다.
  alert?: string;
};

export function OfficeScene({ characters, lit, working, hadWork, connected, alert }: OfficeSceneProps) {
  const [engine] = useState(() => new SceneEngine());
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const nightRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const frontNightRef = useRef<HTMLCanvasElement>(null);

  // 노을 무렵과 불 꺼진 밤을 한 번씩 그려 두고, 불이 꺼지면 밤 그림이 서서히 드러난다.
  // 보스 책상 앞판은 앉은 보스를 가리도록 캐릭터 층에 따로 그린다.
  useEffect(() => {
    const day = bgRef.current?.getContext("2d");
    const night = nightRef.current?.getContext("2d");
    const front = frontRef.current?.getContext("2d");
    const frontNight = frontNightRef.current?.getContext("2d");
    if (day) drawOffice(day, "sunset");
    if (night) drawOffice(night, "night");
    if (front) drawDeskFront(front, "sunset");
    if (frontNight) drawDeskFront(frontNight, "night");
  }, []);

  useEffect(() => {
    engine.sync(characters, lit, working);
  }, [engine, characters, lit, working]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      // 백그라운드 탭처럼 프레임이 드물게 와도 실제 시간과 비슷하게 움직이도록 한 번에 최대 0.5초까지 진행한다.
      engine.step(Math.min(0.5, (now - last) / 1000));
      last = now;
      redraw();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [engine]);

  const walkers = engine.walkers;
  const boss = engine.boss;
  const secretary = engine.secretary;
  const empty = walkers.length === 0;
  // 턴이 진행 중이면 보스가 혼자 쓰는 모습이 곧 안내이므로 따로 띄우지 않는다.
  const note = !connected
    ? "연결된 세션이 없어요"
    : working
      ? ""
      : engine.lit
        ? hadWork
          ? ""
          : "첫 업무를 기다리는 중이에요"
        : hadWork
          ? "모두 퇴근했어요 · 불이 꺼졌어요"
          : "";

  return (
    <div
      className={cn(styles.scene, engine.lit ? styles.on : styles.off)}
      role="img"
      aria-label="사무실 장면"
    >
      <canvas ref={bgRef} className={styles.bg} width={BG_WIDTH} height={BG_HEIGHT} />
      <canvas ref={nightRef} className={cn(styles.bg, styles.night)} width={BG_WIDTH} height={BG_HEIGHT} />
      <div className={styles.layer}>
        <div className={cn(styles.sign, styles.signRoom)} style={{ left: "calc(263 * var(--p))", top: "calc(53 * var(--p))" }}>
          허용 대기 회의실
        </div>
        <div className={cn(styles.sign, styles.signExit)} style={{ left: "calc(64 * var(--p))", top: "calc(166 * var(--p))" }}>
          퇴근
        </div>
      </div>
      <div className={styles.layer}>
        <canvas ref={frontRef} className={styles.bg} width={BG_WIDTH} height={BG_HEIGHT} style={{ zIndex: BOSS_DESK.bottom }} />
        <canvas
          ref={frontNightRef}
          className={cn(styles.bg, styles.night)}
          width={BG_WIDTH}
          height={BG_HEIGHT}
          style={{ zIndex: BOSS_DESK.bottom }}
        />
        {boss ? <BossSprite boss={boss} /> : null}
        {engine.coffee ? <div className={styles.coffee} style={{ ...position(COFFEE_ON_DESK), zIndex: BOSS_DESK.bottom + 1 }} /> : null}
        {engine.papers.map((p) => (
          <PaperSprite key={p.id} paper={p} />
        ))}
        {secretary ? <SecretarySprite secretary={secretary} /> : null}
        {walkers.map((w) => (
          <WalkerSprite key={w.id} walker={w} />
        ))}
      </div>
      <div className={styles.layer}>
        {boss ? <BossBubble boss={boss} thanking={secretary?.serving === true} /> : null}
        {secretary?.serving ? (
          // 비서는 보스 오른쪽에 서므로, 말풍선을 보스 반대쪽(오른쪽)으로 펼쳐 보스 말풍선과 겹치지 않게 한다.
          <div className={cn(styles.bubble, styles.edgeLeft, styles.coffeeBubble)} style={position(secretary)}>
            커피 드세요 ☕
          </div>
        ) : null}
        {walkers.map((w) => (
          <WalkerBubble key={w.id} walker={w} />
        ))}
      </div>
      {alert ? (
        <div className={cn(styles.note, styles.alert)} role="alert">
          {alert}
        </div>
      ) : empty && note ? (
        <div className={styles.note}>{note}</div>
      ) : null}
    </div>
  );
}

function WalkerSprite({ walker }: { walker: Walker }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const look = useMemo(() => lookFor(walker.id), [walker.id]);
  const { kind, expr, moving } = walker;
  // 걷는 동작은 네 칸을 돈다. 모습이 바뀔 때만 다시 그린다(도트 하나하나를 계산하므로 매 프레임 그리면 무겁다).
  const frame = moving ? walker.frame % 4 : 0;

  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (context) drawSprite(context, { kind, look, expr, frame, moving });
  }, [kind, look, expr, frame, moving]);

  return (
    <div
      className={cn(styles.char, !walker.moving && styles.bob, walker.fading && styles.fading)}
      style={{ ...position(walker), zIndex: Math.round(walker.y) }}
    >
      <canvas
        ref={ref}
        width={SPRITE_WIDTH}
        height={SPRITE_HEIGHT}
        // 캐릭터도 서 있는 자리의 빛을 받는다.
        style={{ transform: `scaleX(${walker.flip})`, filter: `brightness(${brightnessAt(walker.x, walker.y)}) saturate(1.1)` }}
      />
    </div>
  );
}

function BossSprite({ boss }: { boss: Boss }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { pose, seated, moving, cheering } = boss;
  // 걷거나 쓰는 동안에만 동작이 바뀐다. 걸음은 네 칸, 연필은 여섯 칸을 돈다.
  const frame = moving ? boss.frame % 4 : pose === "write" ? boss.frame % 6 : 0;
  const writing = seated && pose === "write";

  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (context) drawBoss(context, { pose, seated, frame, moving, cheering });
  }, [pose, seated, frame, moving, cheering]);

  return (
    <div
      className={cn(
        styles.char,
        styles.boss,
        writing && (cheering ? styles.cheer : styles.writing),
        boss.fading && styles.fading
      )}
      style={{ ...position(boss), zIndex: Math.round(boss.y) }}
      aria-label="보스"
    >
      <canvas
        ref={ref}
        width={BOSS_WIDTH}
        height={BOSS_HEIGHT}
        style={{ transform: `scaleX(${boss.flip})`, filter: `brightness(${brightnessAt(boss.x, boss.y)}) saturate(1.1)` }}
      />
    </div>
  );
}

// 앉은 보스의 말풍선: 결재 중 수고했어요!, 허용 대기를 보며 ?, 혼자 쓰다가 유레카!, 커피를 받으면 고마워요.
// 생각하거나 쓰는 중에는 말풍선 대신 머리 위 전구가 깜빡인다.
function BossBubble({ boss, thanking }: { boss: Boss; thanking: boolean }) {
  if (!boss.seated || boss.pose === "plain") return null;
  const thanks = thanking && boss.pose === "write";
  const eureka = boss.pose === "write" && boss.cheering && !thanks;
  const thinking = (boss.pose === "think" || boss.pose === "write") && !thanks && !eureka;
  if (thinking) return <ThinkingBulb boss={boss} />;
  return (
    <div
      className={cn(
        styles.bubble,
        boss.pose === "confused" && styles.ask,
        (boss.pose === "approve" || thanks) && styles.glad,
        eureka && styles.eureka
      )}
      style={position(boss)}
    >
      {boss.pose === "confused" ? <b>?</b> : boss.pose === "approve" ? "수고했어요!" : thanks ? "고마워요" : "유레카!"}
    </div>
  );
}

// 생각 중인 보스의 머리 위에서 꺼졌다 켜졌다 하는 도트 전구. 켜지면 유리가 노랗게 빛나고 빛줄기가 뻗는다.
const BULB_GLASS: [number, number, number][] = [
  [3, 0, 4], [2, 1, 6], [1, 2, 8], [1, 3, 8], [1, 4, 8], [2, 5, 6], [3, 6, 4],
];
const BULB_RAYS: [number, number, number, number][] = [
  [4, -3.5, 2, 2.5], [-3.5, 2.5, 2.5, 2], [11, 2.5, 2.5, 2], [-1.5, -2, 2, 2], [9.5, -2, 2, 2],
];

function ThinkingBulb({ boss }: { boss: Boss }) {
  return (
    <div className={styles.bulb} style={position(boss)} role="img" aria-label="생각 중">
      <svg viewBox="-4 -4 18 17" shapeRendering="crispEdges" aria-hidden>
        <g className={styles.bulbRays}>
          {BULB_RAYS.map(([x, y, w, h]) => (
            <rect key={`${x},${y}`} x={x} y={y} width={w} height={h} />
          ))}
        </g>
        {/* 테두리를 한 칸 크게 깔고 그 위에 유리를 얹어 도트 외곽선을 만든다. */}
        {BULB_GLASS.map(([x, y, w]) => (
          <rect key={`o${y}`} x={x - 1} y={y - 1} width={w + 2} height={3} fill="#2b1d14" />
        ))}
        <g className={styles.bulbGlass}>
          {BULB_GLASS.map(([x, y, w]) => (
            <rect key={`g${y}`} x={x} y={y} width={w} height={1} />
          ))}
        </g>
        <rect className={styles.bulbShine} x={3} y={1} width={1} height={2} />
        {/* 나사 받침과 꼭지 */}
        <rect x={2} y={7} width={6} height={4} fill="#2b1d14" />
        <rect x={3} y={7} width={4} height={1} fill="#c9ccd6" />
        <rect x={3} y={8} width={4} height={1} fill="#8f94a3" />
        <rect x={3} y={9} width={4} height={1} fill="#c9ccd6" />
        <rect x={4} y={10} width={2} height={2} fill="#2b1d14" />
      </svg>
    </div>
  );
}

// 보스가 흩뿌린 종이. 솟구쳤다 떨어지는 모습은 CSS 애니메이션이 그리고, 엔진이 수명이 다하면 지운다.
function PaperSprite({ paper }: { paper: Paper }) {
  const flight = {
    "--dx": paper.dx.toFixed(1),
    "--dy": paper.dy.toFixed(1),
    "--fall": paper.fall.toFixed(1),
    "--spin": `${paper.spin.toFixed(0)}deg`,
    animationDelay: `${paper.delay.toFixed(2)}s`,
  } as React.CSSProperties;
  return <div className={styles.paper} style={{ ...position(paper), ...flight, zIndex: BOSS_DESK.bottom + 2 }} />;
}

function SecretarySprite({ secretary }: { secretary: Secretary }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { moving, carrying } = secretary;
  const frame = moving ? secretary.frame % 4 : 0;

  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (context) drawSecretary(context, { frame, moving, carrying });
  }, [frame, moving, carrying]);

  return (
    <div
      className={cn(styles.char, styles.tall, !moving && styles.bob, secretary.fading && styles.fading)}
      style={{ ...position(secretary), zIndex: Math.round(secretary.y) }}
      aria-label="비서"
    >
      <canvas
        ref={ref}
        width={SECRETARY_WIDTH}
        height={SECRETARY_HEIGHT}
        style={{ transform: `scaleX(${secretary.flip})`, filter: `brightness(${brightnessAt(secretary.x, secretary.y)}) saturate(1.1)` }}
      />
    </div>
  );
}

function WalkerBubble({ walker }: { walker: Walker }) {
  // 화면 가장자리나 보스 옆(결재 중)에서는 말풍선을 안쪽·보스 반대쪽으로 치우친다.
  const edge = walker.x < 70 ? styles.edgeLeft : walker.x > 262 || walker.reporting ? styles.edgeRight : "";
  const kindColor = { "--kind": KIND_STYLE[walker.kind].accent } as React.CSSProperties;

  return (
    <div
      className={cn(
        styles.bubble,
        edge,
        walker.bubble === "ask" && styles.ask,
        walker.bubble === "sad" && styles.sad,
        (walker.bubble === "glad" || walker.bubble === "done") && styles.glad,
        walker.bubble === "stop" && styles.stop
      )}
      style={{ ...position(walker), ...kindColor, opacity: walker.fading ? 0 : 1 }}
    >
      {walker.bubble === "ask" ? (
        <>
          <b>?</b>
          <span>{walker.label}</span>
        </>
      ) : walker.bubble === "sad" ? (
        "거절됨 · 퇴근할게요"
      ) : walker.bubble === "glad" ? (
        "허용됨 · 일 마쳤어요"
      ) : walker.bubble === "done" ? (
        "일 마쳤어요"
      ) : walker.bubble === "stop" ? (
        "중단됨 · 퇴근할게요"
      ) : (
        <>
          <i className={styles.dot} />
          {walker.label}
        </>
      )}
    </div>
  );
}

function position(at: { x: number; y: number }): React.CSSProperties {
  return { "--x": at.x.toFixed(2), "--y": at.y.toFixed(2) } as React.CSSProperties;
}
