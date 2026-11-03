import { mix, ramp } from "./palette";
import { ellipse, pixelArt } from "./pixel-art";

// 64 x 80 도트 비서: 어깨까지 오는 금발, 흰 블라우스에 빨간 리본, 남색 미니스커트, 검은 구두.
// 갸름한 작은 얼굴, 풍만한 가슴과 잘록한 허리, 길고 볼륨 있는 다리.
// 커피를 들고 올 때는 오른손에 쟁반과 잔을 든다. 폭은 직원과 같은 32 단위, 키는 몸이 긴 만큼 40 단위다.
const K = 2;
const ROWS = 40;
export const SECRETARY_WIDTH = 32 * K;
export const SECRETARY_HEIGHT = ROWS * K;

// 허벅지에서 발목으로 가늘어지고 종아리가 살짝 도톰한 다리. 들어 올린 다리는 발목이 위로 올라간다.
const LEG_TOP = 27.2;
const LEG_BOTTOM = 37.7;
const leg = (cx: number, up: number) => (u: number, v: number) => {
  const t = (v - LEG_TOP) / (LEG_BOTTOM - up - LEG_TOP);
  if (t < 0 || t > 1) return false;
  return Math.abs(u - cx) <= 1.3 - 0.5 * t + 0.2 * Math.exp(-(((t - 0.62) / 0.15) ** 2));
};

const HAIR = ramp(48, 0.72, 0.7, 5, 0.42, 0.3);
const HAIR_BACK = ramp(45, 0.62, 0.58, 5, 0.42, 0.3);
const SKIN = ramp(28, 0.62, 0.8, 5, 0.3, 0.25);
const BLOUSE = ramp(40, 0.25, 0.92, 5, 0.25);
const SKIRT = ramp(228, 0.45, 0.3);
const SHOE = ramp(240, 0.15, 0.18);
const TRAY = ramp(30, 0.12, 0.72);
const CUP = ramp(40, 0.15, 0.95, 5, 0.2);
const INK = "#2a2040";

export type SecretarySpriteOptions = { frame: number; moving: boolean; carrying: boolean };

export function drawSecretary(c: CanvasRenderingContext2D, o: SecretarySpriteOptions) {
  const { add, paint } = pixelArt(32, ROWS, K);
  const f = o.moving ? o.frame % 4 : 0;
  const leftUp = f === 1 ? 1 : 0;
  const rightUp = f === 3 ? 1 : 0;
  const b = f === 1 || f === 3 ? -0.6 : 0;

  // 머리는 직원보다 작게, 몸은 가늘고 다리는 길게 그려 키가 크고 늘씬하게 보인다.
  // HC는 머리 중심의 높이(설계 단위)이고, 얼굴 장식은 모두 이 높이를 기준으로 찍는다.
  const HC = 11.6;
  // 걸을 때 어깨는 그대로 두고 엉덩이만 내딛는 발 쪽으로 살랑인다.
  const hip = f === 1 ? 1.2 : f === 3 ? -1.2 : 0;
  // 어깨까지 내려오는 뒷머리. 몸 뒤에 깔려 어깨 옆으로 끝이 보인다.
  add(HAIR_BACK, (u, v) => {
    const w = v - b;
    const side = Math.abs(u - 16);
    return w >= HC - 2 && w <= 20.8 - Math.max(0, side - 8) * 0.5 && side <= 9.4 + Math.max(0, w - 17) * 0.4;
  }, [12, HC + 2, 10, 9]);
  // 길고 볼륨 있는 다리와 굽 있는 구두
  add(SKIN, leg(14.4, leftUp), [14.4, 28, 1.8, 9]);
  add(SKIN, leg(17.6, rightUp), [17.6, 28, 1.8, 9]);
  add(SHOE, ellipse(14.5, 38.1 - leftUp, 1.8, 0.9), [14.3, 37.7, 1.7, 1]);
  add(SHOE, ellipse(17.7, 38.1 - rightUp, 1.8, 0.9), [17.5, 37.7, 1.7, 1]);
  // 가는 팔. 걸을 때도 어깨가 들썩이지 않게 옆에 붙이고, 오른팔은 커피를 들 때 앞으로 내민다.
  add(BLOUSE, ellipse(10.2, 22 + b, 1.6, 3.4), [9.7, 20.7, 2.5, 5]);
  add(SKIN, ellipse(10.1, 25.5 + b, 1.3, 1.3), [9.8, 25, 1.8, 1.8]);
  if (o.carrying) {
    add(BLOUSE, ellipse(23.2, 21.2 + b, 3, 1.6), [22.5, 20.7, 3.5, 1.8]);
    add(SKIN, ellipse(26.3, 21.2 + b, 1.3, 1.2), [26, 20.9, 1.8, 1.8]);
  } else {
    add(BLOUSE, ellipse(21.8, 22 + b, 1.6, 3.4), [21.3, 20.7, 2.5, 5]);
    add(SKIN, ellipse(21.9, 25.5 + b, 1.3, 1.3), [21.6, 25, 1.8, 1.8]);
  }
  // 가슴에서 잘록한 허리로 좁아지는 블라우스. 어깨는 걸어도 흔들리지 않는다.
  add(BLOUSE, (u, v) => {
    const w = v - b;
    const half = w < 21.6 ? 4.6 + (w - 19) * 0.12 : 4.9 - (w - 21.6) * 0.55;
    return w >= 19 && w <= 25 && Math.abs(u - 16) <= half;
  }, [13.6, 20, 7.8, 6.5]);
  // 블라우스 앞섶의 풍만한 가슴. 두 덩이가 맞닿는 곳에 안쪽 선이 생겨 윤곽이 드러난다.
  add(BLOUSE, ellipse(14, 21.9 + b, 2.5, 2.1), [13, 20.8, 2.8, 2.4]);
  add(BLOUSE, ellipse(18, 21.9 + b, 2.5, 2.1), [17, 20.8, 2.8, 2.4]);
  // 허리에서 둥글게 퍼지는 엉덩이와 무릎 위 미니스커트. 허리는 덜, 엉덩이 아래는 더 살랑인다.
  add(SKIRT, (u, v) => {
    const w = v - b;
    if (w < 24.6 || w > 28.2) return false;
    const half = w < 25.9 ? 3.3 + (w - 24.6) * 1 : 4.6 + (w - 25.9) * 0.15;
    return Math.abs(u - (16 + hip * (0.5 + (w - 24.6) * 0.2))) <= half;
  }, [14.8 + hip, 25, 6, 4]);
  // 머리와 앞머리, 얼굴 양옆으로 어깨까지 내린 옆머리
  // 얼굴은 볼까지는 둥글고 턱 쪽에서만 살짝 좁아져 갸름하다.
  add(SKIN, (u, v) => {
    const dv = (v - b - HC) / 7.8;
    const rx = dv > 0 ? 8.6 * (1 - 0.2 * dv ** 2) : 8.6;
    return ((u - 16) / rx) ** 2 + dv ** 2 <= 1;
  }, [13, HC - 3.4, 9, 8], { bias: 0.14 });
  add(HAIR, (u, v) => {
    const w = v - b;
    const side = Math.abs(u - 16);
    // 옆머리 끝은 어깨에 닿으며 바깥으로 살짝 뻗친다.
    const outer = 9.3 + Math.max(0, w - 17) * 0.45;
    if (side >= 7.7 && side <= outer && w >= HC - 2 && w <= 20.4 - (side - 7.7) * 0.3) return true;
    if (!ellipse(16, HC - 0.8 + b, 9.3, 8.4)(u, v)) return false;
    return w < HC - 2.4 + 1.3 * Math.abs(Math.sin((u - 5.5) * 0.6));
  }, [12.5, HC - 5, 10, 9]);
  if (o.carrying) {
    add(TRAY, ellipse(27.3, 20.1 + b, 3.8, 0.8), [26.5, 19.8, 4, 1]);
    add(CUP, (u, v) => u >= 25.9 && u <= 28.5 && v - b >= 17 && v - b <= 19.5, [26.5, 17.2, 2, 2]);
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
    blk(10, HC + 4.1, 1.7, 0.8, blush);
    blk(20.3, HC + 4.1, 1.7, 0.8, blush);
    // 웃는 입
    blk(15, HC + 5.2, 0.6, 0.6, INK);
    blk(15.5, HC + 5.6, 1.1, 0.6, "#d64a5f");
    blk(16.5, HC + 5.2, 0.6, 0.6, INK);
    // 블라우스 깃의 빨간 리본
    blk(14.6, 19.2, 1.2, 1, "#d63a4a");
    blk(16.2, 19.2, 1.2, 1, "#d63a4a");
    blk(15.5, 19.4, 1, 0.9, "#a82835");
    // 앞머리 옆의 빨간 머리핀
    blk(19.6, HC - 4.6, 1.4, 0.6, "#d63a4a");
    if (o.carrying) {
      // 잔에 담긴 커피와 손잡이
      blk(26.1, 17.2, 2.2, 0.6, "#6b3e22");
      blk(28.5, 17.8, 0.7, 1, CUP[1]);
    }
  }, { shadow: [16 + hip * 0.3, 38.9, 6, 1.1], dy: b });
}
