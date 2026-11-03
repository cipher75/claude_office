import { mix, ramp } from "./palette";
import { ellipse, pixelArt } from "./pixel-art";

// 64 x 72 도트 비서: 올림머리, 흰 블라우스에 빨간 리본, 남색 미니스커트, 검은 구두. 가는 몸에 긴 다리.
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

  // 머리는 직원보다 조금 작게, 몸은 가늘고 다리는 길게 그려 늘씬하게 보인다.
  // H는 머리와 얼굴 장식을 함께 올리는 높이(설계 단위)다.
  const H = -1.4;
  // 머리 위로 틀어 올린 머리
  add(HAIR, ellipse(16, 3.4 + H + b, 3.8, 2.9), [15, 2.2 + H, 4, 3]);
  // 길고 가는 다리와 굽 있는 구두
  add(SKIN, (u, v) => u >= 13.7 && u <= 15.1 && v >= 27.6 && v <= 33.4 - leftUp, [14.2, 28, 1.5, 5]);
  add(SKIN, (u, v) => u >= 16.9 && u <= 18.3 && v >= 27.6 && v <= 33.4 - rightUp, [17.4, 28, 1.5, 5]);
  add(SHOE, ellipse(14.2, 33.8 - leftUp, 1.7, 1), [14, 33.4, 1.5, 1]);
  add(SHOE, ellipse(17.8, 33.8 - rightUp, 1.7, 1), [17.6, 33.4, 1.5, 1]);
  // 가는 팔. 왼팔은 걸음에 맞춰 흔들고, 오른팔은 커피를 들 때 앞으로 내민다.
  add(BLOUSE, ellipse(11, 23.6 + b + swing, 1.4, 2.9), [10.6, 22.4, 2, 4]);
  add(SKIN, ellipse(10.9, 26.6 + b + swing, 1.2, 1.2), [10.6, 26.2, 1.5, 1.5]);
  if (o.carrying) {
    add(BLOUSE, ellipse(22.2, 22.8 + b, 2.6, 1.4), [21.6, 22.4, 3, 1.5]);
    add(SKIN, ellipse(24.8, 22.8 + b, 1.2, 1.1), [24.5, 22.5, 1.5, 1.5]);
  } else {
    add(BLOUSE, ellipse(21, 23.6 + b - swing, 1.4, 2.9), [20.6, 22.4, 2, 4]);
    add(SKIN, ellipse(21.1, 26.6 + b - swing, 1.2, 1.2), [20.8, 26.2, 1.5, 1.5]);
  }
  // 어깨에서 허리로 좁아지는 블라우스와 무릎 위로 오는 미니스커트
  add(BLOUSE, (u, v) => {
    const w = v - b;
    return w >= 20.2 && w <= 25.4 && Math.abs(u - 16) <= 4 - (w - 20.2) * 0.16;
  }, [14, 20.8, 6, 5]);
  add(SKIRT, (u, v) => {
    const w = v - b;
    return w >= 24.8 && w <= 28 && Math.abs(u - 16) <= 3.3 + (w - 24.8) * 0.32;
  }, [14.5, 25, 5, 3]);
  // 머리와 앞머리, 어깨에 닿는 옆머리
  add(SKIN, ellipse(16, 13.8 + H + b, 10.4, 9.4), [12.8, 9.8 + H, 11, 10], { bias: 0.14 });
  add(HAIR, (u, v) => {
    const w = v - b - H;
    if (!ellipse(16, 12.9 + H + b, 11.2, 10)(u, v) || w > 21.4) return false;
    const bang = 10.6 + 1.5 * Math.abs(Math.sin((u - 4.5) * 0.52));
    // 옆머리는 귀 옆으로 가늘게만 내려 얼굴이 넓게 보이게 한다.
    return w < bang || ((u < 6.6 || u > 25.4) && w < 19.6);
  }, [12, 6.5 + H, 11, 10]);
  if (o.carrying) {
    add(TRAY, ellipse(25.8, 21.7 + b, 4, 0.8), [25, 21.4, 4, 1]);
    add(CUP, (u, v) => u >= 24.4 && u <= 27 && v - b >= 18.6 && v - b <= 21.1, [25, 18.8, 2, 2]);
  }

  paint(c, ({ blk, dot }) => {
    // 눈: 속눈썹을 얹은 큰 눈동자
    for (const [ex, side] of [[11.4, -1], [18.6, 1]]) {
      // 눈꼬리에 찍은 속눈썹 한 점. 위로 올리면 이 크기에서는 찌푸린 눈썹처럼 보인다.
      blk(side < 0 ? ex - 0.5 : ex + 2, 14.9 + H, 0.5, 0.5, INK);
      blk(ex, 14.8 + H, 2, 3, INK);
      const x0 = Math.round(ex * K);
      const y0 = Math.round((14.8 + H) * K);
      for (let yy = 3; yy < 6; yy++) for (let xx = 0; xx < 4; xx++) dot(x0 + xx, y0 + yy, yy === 5 ? "#c08a5a" : "#6a4a3a");
      for (const [dx, dy] of [[0, 1], [1, 1], [0, 2], [3, 4]]) dot(x0 + dx, y0 + dy, "#ffffff");
    }
    const blush = mix(SKIN[2], "#ff5f87", 0.5);
    blk(8.4, 18.8 + H, 2.2, 0.9, blush);
    blk(21.4, 18.8 + H, 2.2, 0.9, blush);
    // 웃는 입
    blk(14.9, 20.1 + H, 0.6, 0.6, INK);
    blk(15.5, 20.6 + H, 1.2, 0.6, "#d64a5f");
    blk(16.7, 20.1 + H, 0.6, 0.6, INK);
    // 블라우스 깃의 빨간 리본
    blk(14.8, 20.4, 1, 0.9, "#d63a4a");
    blk(16.2, 20.4, 1, 0.9, "#d63a4a");
    blk(15.6, 20.6, 0.8, 0.8, "#a82835");
    // 올림머리 핀
    blk(18.2, 3 + H, 1.3, 0.7, "#ffd23f");
    if (o.carrying) {
      // 잔에 담긴 커피와 손잡이
      blk(24.6, 18.8, 2.2, 0.6, "#6b3e22");
      blk(27, 19.4, 0.7, 1, CUP[1]);
    }
  }, { shadow: [16, 34.6, 6, 1.2], dy: b });
}
