import qrcodeFactory from 'qrcode-generator';

export interface ArtisticQROptions {
  text: string;
  faviconUrl: string | null;
  dotColor: string;
  bgColor: string;
  canvasSize?: number;
}

const BITMAP_RES = 64;

// QR alignment pattern center-position arrays, indexed by (version - 1), versions 1–10.
// Alignment patterns are structural — corrupting them breaks geometric decoding entirely.
const ALIGN_POS: ReadonlyArray<readonly number[]> = [
  [],            // v1  N=21
  [6, 18],       // v2  N=25
  [6, 22],       // v3  N=29
  [6, 26],       // v4  N=33
  [6, 30],       // v5  N=37
  [6, 34],       // v6  N=41
  [6, 22, 38],   // v7  N=45
  [6, 24, 42],   // v8  N=49
  [6, 26, 46],   // v9  N=53
  [6, 28, 50],   // v10 N=57
];

/* ─── geometry ──────────────────────────────────────────────────────── */

function inFinderArea(row: number, col: number, N: number): boolean {
  return (
    (row < 7 && col < 7) ||
    (row < 7 && col >= N - 7) ||
    (row >= N - 7 && col < 7)
  );
}

function buildAlignmentSet(N: number): Set<number> {
  const version = Math.round((N - 17) / 4);
  const pos = ALIGN_POS[version - 1] ?? [];
  const set = new Set<number>();
  for (const r of pos) {
    for (const c of pos) {
      // Skip positions that overlap with the 3 finder patterns
      if (r < 9 && c < 9) continue;
      if (r < 9 && c > N - 9) continue;
      if (r > N - 9 && c < 9) continue;
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++)
          set.add((r + dr) * N + (c + dc));
    }
  }
  return set;
}

function computeLogoZone(N: number): { logoSize: number; logoOffset: number } {
  // ~13% module-area coverage — well under H-level's 30% EC capacity
  const logoSize = Math.min(Math.floor(0.36 * N), N - 16);
  const logoOffset = Math.floor((N - logoSize) / 2);
  return { logoSize, logoOffset };
}

/* ─── canvas drawing helpers ────────────────────────────────────────── */

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const cr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + cr, y);
  ctx.lineTo(x + w - cr, y);
  ctx.arcTo(x + w, y, x + w, y + cr, cr);
  ctx.lineTo(x + w, y + h - cr);
  ctx.arcTo(x + w, y + h, x + w - cr, y + h, cr);
  ctx.lineTo(x + cr, y + h);
  ctx.arcTo(x, y + h, x, y + h - cr, cr);
  ctx.lineTo(x, y + cr);
  ctx.arcTo(x, y, x + cr, y, cr);
  ctx.closePath();
}

function drawFinderPattern(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, m: number,
  dotColor: string, bgColor: string,
) {
  ctx.fillStyle = dotColor;
  roundedRectPath(ctx, x, y, 7 * m, 7 * m, m * 2.5);
  ctx.fill();

  ctx.fillStyle = bgColor;
  roundedRectPath(ctx, x + m, y + m, 5 * m, 5 * m, m * 1.5);
  ctx.fill();

  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(x + 3.5 * m, y + 3.5 * m, 1.5 * m, 0, Math.PI * 2);
  ctx.fill();
}

/* ─── module rendering decision ─────────────────────────────────────── */

function shouldDraw(
  qr: ReturnType<typeof qrcodeFactory>,
  row: number, col: number,
  bitmap: boolean[][] | null,
  logoSize: number, logoOffset: number,
  alignmentSet: Set<number>, N: number,
): boolean {
  if (bitmap === null) return qr.isDark(row, col);

  const inLogo =
    row >= logoOffset && row < logoOffset + logoSize &&
    col >= logoOffset && col < logoOffset + logoSize;

  if (inLogo) {
    // Alignment patterns are structural — never replace with bitmap
    if (alignmentSet.has(row * N + col)) return qr.isDark(row, col);

    const fRow = Math.min(
      Math.floor(((row - logoOffset) / logoSize) * BITMAP_RES),
      BITMAP_RES - 1,
    );
    const fCol = Math.min(
      Math.floor(((col - logoOffset) / logoSize) * BITMAP_RES),
      BITMAP_RES - 1,
    );
    return bitmap[fRow][fCol];
  }

  return qr.isDark(row, col);
}

/* ─── public: canvas ────────────────────────────────────────────────── */

export async function generateArtisticQR(opts: ArtisticQROptions): Promise<HTMLCanvasElement> {
  const { text, faviconUrl, dotColor, bgColor, canvasSize = 400 } = opts;

  const qr = qrcodeFactory(0, 'H');
  qr.addData(text);
  qr.make();
  const N = qr.getModuleCount();

  const alignmentSet = buildAlignmentSet(N);
  const { logoSize, logoOffset } = computeLogoZone(N);

  let bitmap: boolean[][] | null = null;
  if (faviconUrl) {
    try { bitmap = await loadBitmap(faviconUrl); } catch { /* silent */ }
  }

  const margin = Math.round(canvasSize * 0.025);
  const m = (canvasSize - 2 * margin) / N;
  const dotRadius = m * 0.5;

  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  ctx.fillStyle = dotColor;
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      if (inFinderArea(row, col, N)) continue;
      if (!shouldDraw(qr, row, col, bitmap, logoSize, logoOffset, alignmentSet, N)) continue;
      const cx = margin + (col + 0.5) * m;
      const cy = margin + (row + 0.5) * m;
      ctx.beginPath();
      ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const finders = [{ row: 0, col: 0 }, { row: 0, col: N - 7 }, { row: N - 7, col: 0 }];
  for (const { row, col } of finders) {
    drawFinderPattern(ctx, margin + col * m, margin + row * m, m, dotColor, bgColor);
  }

  return canvas;
}

/* ─── public: SVG string ────────────────────────────────────────────── */

export async function generateArtisticQRSVG(opts: ArtisticQROptions): Promise<string> {
  const { text, faviconUrl, dotColor, bgColor, canvasSize = 1000 } = opts;

  const qr = qrcodeFactory(0, 'H');
  qr.addData(text);
  qr.make();
  const N = qr.getModuleCount();

  const alignmentSet = buildAlignmentSet(N);
  const { logoSize, logoOffset } = computeLogoZone(N);

  let bitmap: boolean[][] | null = null;
  if (faviconUrl) {
    try { bitmap = await loadBitmap(faviconUrl); } catch { /* silent */ }
  }

  const margin = Math.round(canvasSize * 0.025);
  const m = (canvasSize - 2 * margin) / N;
  const dotR = (m * 0.5).toFixed(2);

  const dots: string[] = [];
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      if (inFinderArea(row, col, N)) continue;
      if (!shouldDraw(qr, row, col, bitmap, logoSize, logoOffset, alignmentSet, N)) continue;
      const cx = (margin + (col + 0.5) * m).toFixed(2);
      const cy = (margin + (row + 0.5) * m).toFixed(2);
      dots.push(`<circle cx="${cx}" cy="${cy}" r="${dotR}"/>`);
    }
  }

  const fp2 = (n: number) => n.toFixed(2);
  const finderSVG = [
    { row: 0, col: 0 },
    { row: 0, col: N - 7 },
    { row: N - 7, col: 0 },
  ].map(({ row, col }) => {
    const x = margin + col * m;
    const y = margin + row * m;
    return [
      `<rect x="${fp2(x)}" y="${fp2(y)}" width="${fp2(7*m)}" height="${fp2(7*m)}" rx="${fp2(m*2.5)}" fill="${dotColor}"/>`,
      `<rect x="${fp2(x+m)}" y="${fp2(y+m)}" width="${fp2(5*m)}" height="${fp2(5*m)}" rx="${fp2(m*1.5)}" fill="${bgColor}"/>`,
      `<circle cx="${fp2(x+3.5*m)}" cy="${fp2(y+3.5*m)}" r="${fp2(1.5*m)}" fill="${dotColor}"/>`,
    ].join('');
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasSize} ${canvasSize}" width="${canvasSize}" height="${canvasSize}">
  <rect width="${canvasSize}" height="${canvasSize}" fill="${bgColor}"/>
  <g fill="${dotColor}">${dots.join('')}</g>
  ${finderSVG}
</svg>`;
}

/* ─── favicon → binary bitmap (Otsu threshold, 64×64) ──────────────── */

async function loadBitmap(url: string): Promise<boolean[][]> {
  return new Promise<boolean[][]>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => reject(new Error('timeout')), 8000);
    img.onload = () => {
      clearTimeout(timer);
      const c = document.createElement('canvas');
      c.width = BITMAP_RES;
      c.height = BITMAP_RES;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, BITMAP_RES, BITMAP_RES);
      ctx.drawImage(img, 0, 0, BITMAP_RES, BITMAP_RES);
      const { data } = ctx.getImageData(0, 0, BITMAP_RES, BITMAP_RES);

      const lums = new Float32Array(BITMAP_RES * BITMAP_RES);
      for (let i = 0; i < lums.length; i++) {
        const p = i * 4;
        lums[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      }

      const threshold = otsuThreshold(lums);
      resolve(
        Array.from({ length: BITMAP_RES }, (_, y) =>
          Array.from({ length: BITMAP_RES }, (_, x) =>
            lums[y * BITMAP_RES + x] < threshold,
          ),
        ),
      );
    };
    img.onerror = () => { clearTimeout(timer); reject(new Error('load failed')); };
    img.src = url;
  });
}

function otsuThreshold(lums: Float32Array): number {
  const hist = new Float32Array(256);
  for (const l of lums) hist[Math.min(255, Math.floor(l))]++;
  const total = lums.length;
  for (let i = 0; i < 256; i++) hist[i] /= total;

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = 1 - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > maxVar) { maxVar = between; threshold = t; }
  }
  return threshold;
}
