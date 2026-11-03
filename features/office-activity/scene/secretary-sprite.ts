import { mix, ramp } from "./palette";
import { ellipse, pixelArt } from "./pixel-art";

// 64 x 72 도트 비서: 올림머리, 흰 블라우스에 빨간 리본, 남색 미니스커트, 검은 구두.
// 커피를 들고 올 때는 오른손에 쟁반과 잔을 든다. 직원 스프라이트와 같은 32 x 36 설계 단위다.
const K = 2;
export const SECRETARY_WIDTH = 32 * K;
export const SECRETARY_HEIGHT = 36 * K;

const HAIR = ramp(22, 0.5, 0.3);
const SKIN = ramp(28, 0.62, 0.8, 5, 0.3, 0.25);
const BLOUSE = ramp(40, 0.25, 0.92, 5, 0.25);
const SKIRT = ramp(228, 0.45, 0.3);
const SHOE = ramp(240, 0.15, 0.18);
const TRAY = ramp(30, 0.12, 0.72);
const CUP = ramp(40, 0.15, 0.95, 5, 0.2);
const INK = "#2a2040";

export type SecretarySpriteOptions = { frame: number; moving: boolean; carrying: boolean };

export function drawSecretary(c: CanvasRenderingContext2D, o: SecretarySpriteOptions) {
  const { add, paint } = pixelArt(32, 36, K);
  const f = o.moving ? o.frame % 4 : 0;
  const leftUp = f === 1 ? 1 : 0;
  const rightUp = f === 3 ? 1 : 0;
  const b = f === 1 || f === 3 ? -0.6 : 0;
  const swing = f === 1 ? 0.9 : f === 3 ? -0.9 : 0;

  // 머리 위로 틀어 올린 머리
  add(HAIR, ellipse(16, 3.6 + b, 4.2, 3.2), [15, 2.4, 4, 3]);
  // 다리와 구두
  add(SKIN, (u, v) => u >= 12.6 && u <= 14.6 && v >= 28.5 && v <= 33.2 - leftUp, [13.2, 29, 2, 5]);
  add(SKIN, (u, v) => u >= 17.4 && u <= 19.4 && v >= 28.5 && v <= 33.2 - rightUp, [18, 29, 2, 5]);
  add(SHOE, ellipse(13.4, 33.6 - leftUp, 2.2, 1.2), [13, 33, 2, 1.5]);
  add(SHOE, ellipse(18.6, 33.6 - rightUp, 2.2, 1.2), [18, 33, 2, 1.5]);
  // 왼팔은 걸음에 맞춰 흔들고, 오른팔은 커피를 들 때 앞으로 내민다.
  add(BLOUSE, ellipse(9.2, 25.6 + b + swing, 2, 3.1), [8.6, 24.2, 3, 4]);
  add(SKIN, ellipse(9, 28.6 + b + swing, 1.6, 1.5), [8.6, 28, 2, 2]);
  if (o.carrying) {
    add(BLOUSE, ellipse(23.6, 24.6 + b, 2.8, 1.9), [23, 24, 3, 2]);
    add(SKIN, ellipse(26.4, 24.6 + b, 1.5, 1.3), [26, 24, 2, 2]);
  } else {
    add(BLOUSE, ellipse(22.8, 25.6 + b - swing, 2, 3.1), [22.2, 24.2, 3, 4]);
    add(SKIN, ellipse(23, 28.6 + b - swing, 1.6, 1.5), [22.6, 28, 2, 2]);
  }
  // 블라우스와 무릎 위로 오는 미니스커트
  add(BLOUSE, (u, v) => {
    const w = v - b;
    return w >= 21.8 && w <= 27 && Math.abs(u - 16) <= 4.6 + (w - 21.8) * 0.12;
  }, [13.5, 22.5, 7, 6]);
  add(SKIRT, (u, v) => {
    const w = v - b;
    return w >= 26.4 && w <= 29.4 && Math.abs(u - 16) <= 5 + (w - 26.4) * 0.35;
  }, [14, 26.5, 7, 3]);
  // 머리와 앞머리, 어깨에 닿는 옆머리
  add(SKIN, ellipse(16, 14.2 + b, 11.2, 10), [12.5, 10, 12, 11], { bias: 0.14 });
  add(HAIR, (u, v) => {
    const w = v - b;
    if (!ellipse(16, 13.2 + b, 12, 10.6)(u, v) || w > 21) return false;
    const bang = 10.8 + 1.6 * Math.abs(Math.sin((u - 4) * 0.5));
    return w < bang || u < 6.4 || u > 25.6;
  }, [12, 7, 12, 10]);
  if (o.carrying) {
    add(TRAY, ellipse(27, 23.4 + b, 4.4, 0.9), [26, 23, 4, 1]);
    add(CUP, (u, v) => u >= 25.6 && u <= 28.4 && v - b >= 20.2 && v - b <= 22.8, [26.4, 20.5, 2, 2]);
  }

  paint(c, ({ blk, dot }) => {
    // 눈: 속눈썹을 얹은 큰 눈동자
    for (const ex of [11, 19]) {
      blk(ex - 0.4, 14.4, 2.8, 0.7, INK);
      blk(ex, 15, 2, 3, INK);
      const x0 = ex * K;
      const y0 = 15 * K;
      for (let yy = 3; yy < 6; yy++) for (let xx = 0; xx < 4; xx++) dot(x0 + xx, y0 + yy, yy === 5 ? "#c08a5a" : "#6a4a3a");
      for (const [dx, dy] of [[0, 1], [1, 1], [0, 2], [3, 4]]) dot(x0 + dx, y0 + dy, "#ffffff");
    }
    const blush = mix(SKIN[2], "#ff5f87", 0.5);
    blk(7.6, 19.2, 2.4, 1, blush);
    blk(22, 19.2, 2.4, 1, blush);
    // 웃는 입
    blk(14.8, 20.6, 0.6, 0.6, INK);
    blk(15.4, 21.1, 1.4, 0.6, "#d64a5f");
    blk(16.8, 20.6, 0.6, 0.6, INK);
    // 블라우스 깃의 빨간 리본
    blk(14.6, 22, 1.2, 1, "#d63a4a");
    blk(16.4, 22, 1.2, 1, "#d63a4a");
    blk(15.6, 22.2, 1, 1, "#a82835");
    // 올림머리 핀
    blk(18.6, 3.2, 1.4, 0.8, "#ffd23f");
    if (o.carrying) {
      // 잔에 담긴 커피와 손잡이
      blk(25.8, 20.4, 2.4, 0.6, "#6b3e22");
      blk(28.4, 21, 0.7, 1.1, CUP[1]);
    }
  }, { shadow: [16, 34.6, 8, 1.4], dy: b });
}
