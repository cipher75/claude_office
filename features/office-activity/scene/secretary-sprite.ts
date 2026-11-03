import { mix, ramp } from "./palette";
import { ellipse, pixelArt } from "./pixel-art";

// 64 x 72 도트 비서: 올림머리, 흰 블라우스에 빨간 리본, 남색 미니스커트, 검은 구두. 작은 머리, 가는 몸, 긴 다리.
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

  // 머리는 직원보다 작게, 몸은 가늘고 다리는 길게 그려 키가 크고 늘씬하게 보인다.
  // HC는 머리 중심의 높이(설계 단위)이고, 얼굴 장식은 모두 이 높이를 기준으로 찍는다.
  const HC = 11.6;
  // 걸을 때 걸음에 맞춰 허리와 치마가 좌우로 살랑인다. 내딛는 발 쪽으로 기운다.
  const hip = f === 1 ? 1 : f === 3 ? -1 : 0;
  // 머리 위로 틀어 올린 머리
  add(HAIR, ellipse(16, HC - 8.4 + b, 3.2, 2.5), [15, HC - 9.4, 4, 3]);
  // 길고 가는 다리와 굽 있는 구두
  add(SKIN, (u, v) => u >= 14 && u <= 15.3 && v >= 25.6 && v <= 33.4 - leftUp, [14.4, 26, 1.4, 7]);
  add(SKIN, (u, v) => u >= 16.7 && u <= 18 && v >= 25.6 && v <= 33.4 - rightUp, [17.2, 26, 1.4, 7]);
  add(SHOE, ellipse(14.5, 33.8 - leftUp, 1.6, 0.9), [14.3, 33.4, 1.5, 1]);
  add(SHOE, ellipse(17.5, 33.8 - rightUp, 1.6, 0.9), [17.3, 33.4, 1.5, 1]);
  // 가는 팔. 왼팔은 걸음에 맞춰 흔들고, 오른팔은 커피를 들 때 앞으로 내민다.
  add(BLOUSE, ellipse(11.6, 21.2 + b + swing, 1.3, 2.6), [11.2, 20.2, 2, 4]);
  add(SKIN, ellipse(11.5, 23.9 + b + swing, 1.1, 1.1), [11.2, 23.5, 1.5, 1.5]);
  if (o.carrying) {
    add(BLOUSE, ellipse(22, 20.8 + b, 2.6, 1.3), [21.4, 20.4, 3, 1.5]);
    add(SKIN, ellipse(24.6, 20.8 + b, 1.1, 1), [24.3, 20.5, 1.5, 1.5]);
  } else {
    add(BLOUSE, ellipse(20.4, 21.2 + b - swing, 1.3, 2.6), [20, 20.2, 2, 4]);
    add(SKIN, ellipse(20.5, 23.9 + b - swing, 1.1, 1.1), [20.2, 23.5, 1.5, 1.5]);
  }
  // 어깨에서 허리로 좁아지는 블라우스와 무릎 위로 오는 미니스커트. 아래로 갈수록 살랑임을 더 받는다.
  add(BLOUSE, (u, v) => {
    const w = v - b;
    const center = 16 + hip * Math.max(0, (w - 19) / 4.6) * 0.5;
    return w >= 19 && w <= 23.6 && Math.abs(u - center) <= 3.7 - (w - 19) * 0.18;
  }, [14.2, 19.6, 6, 5]);
  add(SKIRT, (u, v) => {
    const w = v - b;
    return w >= 23.2 && w <= 26 && Math.abs(u - (16 + hip)) <= 3 + (w - 23.2) * 0.36;
  }, [14.8 + hip, 23.4, 5, 3]);
  // 머리와 앞머리, 귀 옆으로 내린 옆머리
  add(SKIN, ellipse(16, HC + b, 8.6, 7.8), [13, HC - 3.4, 9, 8], { bias: 0.14 });
  add(HAIR, (u, v) => {
    const w = v - b;
    if (!ellipse(16, HC - 0.8 + b, 9.3, 8.4)(u, v) || w > HC + 7.8) return false;
    const bang = HC - 2.4 + 1.3 * Math.abs(Math.sin((u - 5.5) * 0.6));
    return w < bang || ((u < 8.2 || u > 23.8) && w < HC + 4.8);
  }, [12.5, HC - 5, 10, 9]);
  if (o.carrying) {
    add(TRAY, ellipse(25.6, 19.7 + b, 3.8, 0.8), [24.8, 19.4, 4, 1]);
    add(CUP, (u, v) => u >= 24.2 && u <= 26.8 && v - b >= 16.6 && v - b <= 19.1, [24.8, 16.8, 2, 2]);
  }

  paint(c, ({ blk, dot }) => {
    // 눈: 큰 눈동자와 눈꼬리의 속눈썹 한 점. 위로 올리면 이 크기에서는 찌푸린 눈썹처럼 보인다.
    const eyeY = HC + 0.6;
    for (const [ex, side] of [[12.3, -1], [17.7, 1]]) {
      blk(side < 0 ? ex - 0.5 : ex + 2, eyeY + 0.1, 0.5, 0.5, INK);
      blk(ex, eyeY, 2, 3, INK);
      const x0 = Math.round(ex * K);
      const y0 = Math.round(eyeY * K);
      for (let yy = 3; yy < 6; yy++) for (let xx = 0; xx < 4; xx++) dot(x0 + xx, y0 + yy, yy === 5 ? "#c08a5a" : "#6a4a3a");
      for (const [dx, dy] of [[0, 1], [1, 1], [0, 2], [3, 4]]) dot(x0 + dx, y0 + dy, "#ffffff");
    }
    const blush = mix(SKIN[2], "#ff5f87", 0.5);
    blk(9.8, HC + 4.1, 1.8, 0.8, blush);
    blk(20.4, HC + 4.1, 1.8, 0.8, blush);
    // 웃는 입
    blk(15, HC + 5.2, 0.6, 0.6, INK);
    blk(15.5, HC + 5.6, 1.1, 0.6, "#d64a5f");
    blk(16.5, HC + 5.2, 0.6, 0.6, INK);
    // 블라우스 깃의 빨간 리본
    blk(14.9, 19.2, 0.9, 0.8, "#d63a4a");
    blk(16.2, 19.2, 0.9, 0.8, "#d63a4a");
    blk(15.6, 19.4, 0.8, 0.7, "#a82835");
    // 올림머리 핀
    blk(17.7, HC - 8.8, 1.2, 0.6, "#ffd23f");
    if (o.carrying) {
      // 잔에 담긴 커피와 손잡이
      blk(24.4, 16.8, 2.2, 0.6, "#6b3e22");
      blk(26.8, 17.4, 0.7, 1, CUP[1]);
    }
  }, { shadow: [16 + hip * 0.3, 34.6, 5.4, 1.1], dy: b });
}
