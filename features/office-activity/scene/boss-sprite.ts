import type { BossPose } from "./scene-engine";
import { mix, ramp } from "./palette";
import { ellipse, pixelArt, type Blk, type Dot } from "./pixel-art";

// 64 x 72 도트 보스: 은발, 둥근 금테 안경, 콧수염, 남색 정장에 빨간 넥타이.
// 앉아 있을 때는 책상 상판 높이에서 몸을 잘라 그리고, 퇴근할 때는 다리까지 그려 걷게 한다.
const K = 2;
export const BOSS_WIDTH = 32 * K;
export const BOSS_HEIGHT = 36 * K;

const SUIT = ramp(226, 0.42, 0.33);
const SKIN = ramp(28, 0.6, 0.78, 5, 0.3, 0.25);
const HAIR = ramp(220, 0.08, 0.7);
const PANTS = ramp(226, 0.3, 0.26);
const SHOE = ramp(20, 0.45, 0.28);
const WOOD = ramp(28, 0.55, 0.5);
const STAMP = ramp(0, 0.65, 0.42);
const GOLD = ramp(45, 0.85, 0.55);
const PAPER = ramp(50, 0.3, 0.9, 5, 0.25);
const INK = "#2a2040";
const BROW = "#4b4f5c";
const IRIS = ["#2a2040", "#3b2a4a", "#6a4a3a", "#9a6a4a", "#c08a5a"];
// 앉은 보스가 책상 상판 뒤로 숨는 높이(설계 단위).
const DESK_CUT = 27.2;

export type BossSpriteOptions = { pose: BossPose; seated: boolean; frame: number; moving: boolean };

type Arm = "desk" | "chin" | "stamp" | "write" | "side";
type Face = "think" | "focus" | "happy" | "confused" | "plain";

function look(o: BossSpriteOptions): { face: Face; arm: Arm; turn: number } {
  if (!o.seated) return { face: "plain", arm: "side", turn: 0 };
  if (o.pose === "think") return { face: "think", arm: "chin", turn: 0 };
  // 혼자 쓰는 중: 종이를 내려다보며 펜을 쥔 손을 움직인다.
  if (o.pose === "write") return { face: "focus", arm: "write", turn: 0 };
  if (o.pose === "approve") return { face: "happy", arm: "stamp", turn: 0 };
  // 허용 대기: 오른쪽 회의실 쪽으로 고개를 돌린다.
  if (o.pose === "confused") return { face: "confused", arm: "desk", turn: 2.2 };
  return { face: "plain", arm: "desk", turn: 0 };
}

export function drawBoss(c: CanvasRenderingContext2D, o: BossSpriteOptions) {
  const { add: addPart, paint } = pixelArt(32, 36, K);
  const add = (
    r: string[],
    test: (u: number, v: number) => boolean,
    light: [number, number, number, number],
    opt: number | { inner?: boolean } = 0
  ) => addPart(r, test, light, typeof opt === "number" ? { bias: opt } : opt);

  const { face, arm, turn: t } = look(o);
  const cut = o.seated ? DESK_CUT : 31;
  const f = o.moving ? o.frame % 4 : 0;
  // 쓰는 손은 종이 위를 오른쪽으로 세 칸 옮겨 가다가 줄을 바꾼다.
  const pen = arm === "write" ? [0, 1.1, 2.2, 0.6][o.frame % 4] : 0;
  const leftUp = f === 1 ? 1 : 0;
  const rightUp = f === 3 ? 1 : 0;
  const swing = f === 1 ? 0.9 : f === 3 ? -0.9 : 0;

  if (!o.seated) {
    add(PANTS, (u, v) => u >= 11.2 && u <= 14.8 && v >= 28 && v <= 33.4 - leftUp, [12.4, 29, 3, 5]);
    add(PANTS, (u, v) => u >= 17.2 && u <= 20.8 && v >= 28 && v <= 33.4 - rightUp, [18.6, 29, 3, 5]);
    add(SHOE, ellipse(12.8, 33.6 - leftUp, 2.8, 1.5), [12, 32.6, 3, 2]);
    add(SHOE, ellipse(19.4, 33.6 - rightUp, 2.8, 1.5), [19, 32.6, 3, 2]);
  }
  add(SUIT, (u, v) => v >= 20.5 && v <= cut && Math.abs(u - 16) <= Math.min(7.4 + (v - 20.5) * 0.6, 10), [13, 21, 9, 7]);
  if (arm === "side") {
    add(SUIT, ellipse(6.4, 26 + swing, 2.4, 3.6), [6, 24.5, 3, 4]);
    add(SUIT, ellipse(25.6, 26 - swing, 2.4, 3.6), [25, 24.5, 3, 4]);
    add(SKIN, ellipse(6.4, 29.4 + swing, 1.8, 1.6), [6, 29, 2, 2]);
    add(SKIN, ellipse(25.6, 29.4 - swing, 1.8, 1.6), [25, 29, 2, 2]);
  } else {
    add(SUIT, ellipse(10.4, 27.8, 4, 1.8), [9, 27, 4, 2]);
    add(SKIN, ellipse(14.4, 28.3, 1.8, 1.4), [14, 28, 2, 2]);
    if (arm === "desk") {
      add(SUIT, ellipse(21.6, 27.8, 4, 1.8), [20, 27, 4, 2]);
      add(SKIN, ellipse(17.6, 28.3, 1.8, 1.4), [17, 28, 2, 2]);
    } else if (arm === "write") {
      // 책상 위 종이와 그 위를 오가는 오른손
      add(PAPER, (u, v) => u >= 17.6 && u <= 25.6 && v >= 25.2 && v <= cut, [19, 25.3, 6, 2], { inner: false });
      add(SUIT, ellipse(25 + pen * 0.4, 26.6, 3.4, 1.8), [24, 26, 4, 2]);
      add(SKIN, ellipse(20.8 + pen, 26.4, 1.7, 1.4), [20.5, 26, 2, 2]);
    } else add(SUIT, ellipse(23.4, 24.2, 2.3, 3.6), [22.5, 23, 3, 4]);
  }
  if (t) add(SKIN, ellipse(5.8, 15.6, 1.6, 2.3), [5.4, 15, 2, 2.5]);
  else {
    add(SKIN, ellipse(4.6, 15.6, 1.6, 2.3), [4.2, 15, 2, 2.5]);
    add(SKIN, ellipse(27.4, 15.6, 1.6, 2.3), [27, 15, 2, 2.5]);
  }
  add(SKIN, ellipse(16 + t * 0.3, 14.2, 11.4, 10.2), [12.5 + t, 10, 12, 11], 0.14);
  // 뒤로 넘긴 은발. 고개를 돌리면 왼쪽 옆머리가 더 보인다.
  add(HAIR, (u, v) => {
    if (!ellipse(16 + t * 0.3, 13.2, 12, 10.6)(u, v)) return false;
    if (v < 8.6 + 0.6 * Math.sin(u * 0.7)) return true;
    return t ? (u < 7.8 && v < 16.5) || (u > 26.6 && v < 12.5) : (u < 6.2 || u > 25.8) && v < 15;
  }, [11, 6, 12, 8]);
  // 턱을 괸 손은 얼굴 오른쪽 턱선에 걸친다.
  if (arm === "chin") add(SKIN, ellipse(23.2, 23, 2, 1.7), [22.6, 22.5, 2, 2], -0.15);
  if (arm === "stamp") {
    add(WOOD, ellipse(23.4, 17.6, 1.1, 2.4), [23, 16.5, 1.5, 2.5]);
    add(SKIN, ellipse(23.4, 20.6, 1.9, 1.6), [23, 20, 2, 2]);
    add(STAMP, (u, v) => u >= 21.6 && u <= 25.2 && v >= 22.2 && v <= 23.8, [23, 22.5, 2, 1]);
  }

  paint(c, ({ blk, dot }) => {
    // 셔츠 깃, 빨간 넥타이, 금색 행커치프
    for (let y = Math.round(20.6 * K); y < cut * K; y++) {
      for (let x = 0; x < BOSS_WIDTH; x++) {
        const u = (x + 0.5) / K;
        const v = (y + 0.5) / K;
        if (Math.abs(u - 16) <= (v - 20.6) * 0.62 && v < 25) dot(x, y, "#fbfbf2");
        if (v > 21.6 && Math.abs(u - 16) <= 0.7 + (v - 21.6) * 0.12) dot(x, y, v < 22.6 ? "#a82835" : "#d63a4a");
      }
    }
    blk(20.2, 23.4, 1.8, 0.9, "#ffd23f");
    if (arm === "write") {
      // 종이에 써 내려간 줄과 손에 쥔 펜
      for (let line = 0; line < 2; line++) blk(18.2, 25.8 + line * 0.9, 1 + (o.frame % 4) * 1.2 + line * 0.8, 0.5, "#7a7f9a");
      blk(21.4 + pen, 23.6, 0.6, 2.4, "#3a3550");
      blk(21.4 + pen, 23.2, 0.6, 0.5, GOLD[3]);
    }
    drawFace(blk, dot, face, t);
    for (let x = 12; x < 22; x++) dot(x + 8, 6 + Math.round(Math.abs(x - 17) * 0.4), HAIR[4]);
  }, { shadow: o.seated ? undefined : [16, 34.6, 9.5, 1.6] });
}

function drawFace(blk: Blk, dot: Dot, face: Face, t: number) {
  const eyes = [10.6 + t, 19.4 + t];
  const blush = mix(SKIN[2], "#ff5f87", 0.4);
  blk(7.6 + t, 19.4, 2.2, 1, blush);
  blk(22.4 + t, 19.4, 2.2, 1, blush);
  // 눈썹은 안경테 위. 의아할 때는 한쪽만 치켜올린다.
  if (face === "confused") {
    blk(eyes[0] - 0.6, 12.8, 3.4, 1, BROW);
    blk(eyes[0] + 2.6, 13.3, 1, 0.6, BROW);
    blk(eyes[1] - 0.4, 11.2, 3.4, 1, BROW);
    blk(eyes[1] - 0.8, 12, 1, 0.6, BROW);
  } else {
    const y = face === "think" ? 11.9 : 12.5;
    blk(eyes[0] - 0.6, y, 3.4, 1, BROW);
    blk(eyes[1] - 0.6, y, 3.4, 1, BROW);
  }
  // 큰 눈: 모서리를 깎은 6 x 7 흰자에 3 x 5 눈동자와 하이라이트 두 개.
  const eyeAt = (e: number) => [Math.round((e - 0.6) * K), Math.round(14.4 * K)];
  for (const e of eyes) {
    const [x0, y0] = eyeAt(e);
    if (face === "happy") {
      for (const [dx, dy] of [[0, 4], [1, 3], [2, 2], [3, 2], [4, 3], [5, 4], [1, 4], [4, 4]]) dot(x0 + dx, y0 + dy, INK);
      continue;
    }
    for (let yy = 0; yy < 7; yy++) {
      for (let xx = 0; xx < 6; xx++) {
        if ((yy === 0 || yy === 6) && (xx === 0 || xx === 5)) continue;
        dot(x0 + xx, y0 + yy, yy === 0 || xx === 0 || xx === 5 ? INK : "#ffffff");
      }
    }
    // 생각할 때는 위를, 쓸 때는 아래(종이)를, 의아할 때는 오른쪽(회의실)을 본다.
    const px = face === "confused" ? 2 : 1;
    const py = face === "think" ? 1 : face === "focus" ? 3 : 2;
    for (let yy = 0; yy < 5 && py + yy <= 6; yy++) for (let xx = 0; xx < 3; xx++) dot(x0 + px + xx, y0 + py + yy, IRIS[yy]);
    dot(x0 + px, y0 + py, "#ffffff");
    dot(x0 + px + 1, y0 + py, "#ffffff");
    dot(x0 + px, y0 + py + 1, "#ffffff");
    dot(x0 + px + 2, y0 + py + 3, "#ffffff");
  }
  // 둥근 금테 안경
  for (const e of eyes) {
    const [ex, ey] = eyeAt(e);
    const x0 = ex - 2;
    const y0 = ey - 1;
    for (let xx = 1; xx < 9; xx++) {
      dot(x0 + xx, y0, GOLD[3]);
      dot(x0 + xx, y0 + 8, GOLD[1]);
    }
    for (let yy = 1; yy < 8; yy++) {
      dot(x0, y0 + yy, GOLD[2]);
      dot(x0 + 9, y0 + yy, GOLD[2]);
    }
    dot(x0 + 2, y0 + 1, "#fff8d6");
  }
  const [left] = eyeAt(eyes[0]);
  const [right, top] = eyeAt(eyes[1]);
  for (let xx = left + 8; xx < right - 2; xx++) dot(xx, top + 1, GOLD[2]);
  // 콧수염과 입
  const mx = 16 + t;
  blk(mx - 2.6, 19.4, 5.2, 1.2, HAIR[0]);
  blk(mx - 3.2, 20.2, 1, 1, HAIR[0]);
  blk(mx + 2.2, 20.2, 1, 1, HAIR[0]);
  for (let xx = Math.round((mx - 2.4) * K); xx < Math.round((mx + 2.4) * K); xx += 2) dot(xx, Math.round(19.4 * K), HAIR[2]);
  if (face === "happy") {
    blk(mx - 1.6, 21.6, 3.2, 0.6, INK);
    blk(mx - 2.2, 21.1, 0.6, 0.6, INK);
    blk(mx + 1.6, 21.1, 0.6, 0.6, INK);
  } else if (face === "confused") {
    blk(mx - 0.4, 21.3, 1.4, 1.2, INK);
    dot(Math.round((mx - 0.1) * K), Math.round(21.6 * K), "#e85a6f");
    blk(3.2, 9, 1.4, 1, "#bfe6ff");
    blk(2.8, 10, 2, 2, "#6ec6ff");
  } else blk(mx - 0.8, 21.6, 1.8, 0.6, INK);
}
