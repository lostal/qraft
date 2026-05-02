import { useState, useRef, useCallback, useEffect } from 'react';
import { Download, Sparkles, Loader2, Link2, QrCode, RotateCcw, ChevronRight } from 'lucide-react';

/* ─── helpers ─────────────────────────────────────────── */

function rgbToHex([r, g, b]: number[]): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function getLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    return u.hostname;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

function normalizeUrl(url: string): string {
  if (!url) return '';
  return url.startsWith('http') ? url : 'https://' + url;
}

/* ─── types ───────────────────────────────────────────── */

type Status = 'idle' | 'loading' | 'done' | 'error';

interface Palette {
  all: string[];
  dominant: string;
  background: string;
}

/* ─── QR options builder ──────────────────────────────── */

function buildQROptions(
  data: string,
  imageUrl: string | null,
  dotColor: string,
  bgColor: string,
  size = 380
) {
  return {
    width: size,
    height: size,
    type: 'canvas' as const,
    data,
    ...(imageUrl ? { image: imageUrl } : {}),
    margin: 6,
    qrOptions: { errorCorrectionLevel: 'H' as const },
    dotsOptions: { color: dotColor, type: 'dots' as const },
    backgroundOptions: { color: bgColor, round: 0 },
    ...(imageUrl ? {
      // crossOrigin required so canvas isn't tainted → downloads work
      imageOptions: { crossOrigin: 'anonymous', margin: 6, imageSize: 0.3, hideBackgroundDots: true },
    } : {}),
    cornersSquareOptions: { type: 'extra-rounded' as const, color: dotColor },
    cornersDotOptions: { type: 'dot' as const, color: dotColor },
  };
}

/* ─── component ───────────────────────────────────────── */

export default function QRGenerator() {
  const [sourceUrl, setSourceUrl] = useState('');
  const [qrContent, setQrContent] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [favicon, setFavicon] = useState<string | null>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [dotColor, setDotColor] = useState('#1a1a2e');
  const [bgColor, setBgColor] = useState('#ffffff');

  const qrContainerRef = useRef<HTMLDivElement>(null);
  const qrInstanceRef = useRef<any>(null);
  const colorUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // blob URL for the favicon (CORS-safe) — null when favicon fetch failed
  const faviconBlobRef = useRef<string | null>(null);

  /* render / re-render QR */
  const renderQR = useCallback(
    async (data: string, imgUrl: string | null, dots: string, bg: string) => {
      if (!qrContainerRef.current) return;
      const { default: QRCodeStyling } = await import('qr-code-styling');
      const qr = new QRCodeStyling(buildQROptions(data, imgUrl, dots, bg));
      qrContainerRef.current.innerHTML = '';
      qr.append(qrContainerRef.current);
      qrInstanceRef.current = qr;
    },
    []
  );

  /* main generation flow */
  const generate = useCallback(async () => {
    const src = sourceUrl.trim();
    const content = qrContent.trim();
    if (!src || !content) return;

    setStatus('loading');
    setErrorMsg('');

    const domain = extractDomain(src);
    const googleFaviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    // wsrv.nl is a purpose-built image proxy that adds Access-Control-Allow-Origin: *
    // It converts to PNG and resizes, making it safe for canvas color extraction.
    const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(googleFaviconUrl)}&output=png&w=64&h=64`;

    let dots = '#111827';
    let bg = '#f8f8f8';
    let allColors: string[] = [dots, bg];
    let qrImageUrl: string | null = null;

    /* attempt color extraction — non-fatal if it fails */
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // wsrv.nl returns Access-Control-Allow-Origin: *
      img.src = wsrvUrl;
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('image load failed'));
        setTimeout(rej, 8000);
      });

      const { default: ColorThiefCtor } = await import('colorthief');
      // colorthief types resolve to node entry; cast for browser usage
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ct = new (ColorThiefCtor as any)();
      const raw = ct.getPalette(img, 6, 1) as number[][];
      allColors = raw.map(rgbToHex);
      dots = allColors[0];

      /* choose background: lightest palette color that contrasts with dots */
      let lightestLum = -1;
      let lightestColor = '#f8f8f8';
      for (const hex of allColors) {
        const lum = getLuminance(hex);
        if (lum > lightestLum) { lightestLum = lum; lightestColor = hex; }
      }
      bg = lightestLum > 0.35 ? lightestColor : '#f8f8f8';

      // Guarantee readable contrast
      if (Math.abs(getLuminance(dots) - getLuminance(bg)) < 0.25) {
        bg = getLuminance(dots) < 0.5 ? '#f8f8f8' : '#111827';
      }

      // wsrv.nl CORS allows canvas embedding without tainting → downloads work
      qrImageUrl = wsrvUrl;
    } catch {
      /* color extraction failed — generate QR without image, use defaults */
    }

    faviconBlobRef.current = qrImageUrl;
    setFavicon(wsrvUrl); // display-only badge (no crossOrigin needed for <img>)
    setDotColor(dots);
    setBgColor(bg);
    setPalette({ dominant: dots, background: bg, all: allColors.slice(0, 6) });

    await renderQR(normalizeUrl(content), qrImageUrl, dots, bg);
    setStatus('done');
  }, [sourceUrl, qrContent, renderQR]);

  /* debounce color changes → re-render QR */
  useEffect(() => {
    if (status !== 'done') return;
    if (colorUpdateTimer.current) clearTimeout(colorUpdateTimer.current);
    colorUpdateTimer.current = setTimeout(() => {
      renderQR(normalizeUrl(qrContent), faviconBlobRef.current, dotColor, bgColor);
    }, 300);
    return () => {
      if (colorUpdateTimer.current) clearTimeout(colorUpdateTimer.current);
    };
  }, [dotColor, bgColor]);

  /* download */
  const download = useCallback(
    async (fmt: 'png' | 'svg') => {
      if (!qrContent) return;
      if (fmt === 'png' && qrInstanceRef.current) {
        await qrInstanceRef.current.download({ name: 'qraft-qr', extension: 'png' });
        return;
      }
      const { default: QRCodeStyling } = await import('qr-code-styling');
      const svgQr = new QRCodeStyling({
        ...buildQROptions(normalizeUrl(qrContent), faviconBlobRef.current, dotColor, bgColor),
        type: 'svg' as const,
      });
      await svgQr.download({ name: 'qraft-qr', extension: 'svg' });
    },
    [qrContent, dotColor, bgColor]
  );

  const reset = () => {
    setStatus('idle');
    setFavicon(null);
    setPalette(null);
    setDotColor('#1a1a2e');
    setBgColor('#ffffff');
    setErrorMsg('');
    faviconBlobRef.current = null;
    if (qrContainerRef.current) qrContainerRef.current.innerHTML = '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    generate();
  };

  /* ─── render ─────────────────────────────────────────── */
  return (
    <div className="min-h-screen flex flex-col">
      {/* ── nav ── */}
      <header className="px-6 py-5 flex items-center justify-between border-b border-ink-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber flex items-center justify-center">
            <QrCode className="w-4 h-4 text-ink-950" />
          </div>
          <span className="font-display text-xl font-semibold text-ink-50 italic">qraft</span>
        </div>
        <span className="hidden sm:block text-xs font-mono text-ink-500 tracking-wide">
          brand-aware QR generator
        </span>
      </header>

      {/* ── hero ── */}
      <section className="px-6 pt-16 pb-12 text-center">
        <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-light italic leading-none tracking-tight text-ink-50 mb-4">
          QR codes that{' '}
          <span className="text-gradient-amber not-italic font-semibold">wear your brand</span>
        </h1>
        <p className="text-ink-400 font-sans text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
          Drop any URL — we extract its colors and favicon to craft a QR code
          that feels native to the brand. No backend. No account.
        </p>
      </section>

      {/* ── main content ── */}
      <main className="flex-1 px-4 sm:px-6 pb-16 max-w-6xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6 items-start">
          {/* ── left panel ── */}
          <div className="bg-ink-800 border border-ink-700 rounded-2xl p-6 space-y-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* source url */}
              <div>
                <label className="label" htmlFor="source-url">
                  Website URL <span className="text-ink-600 normal-case tracking-normal">(for colors &amp; favicon)</span>
                </label>
                <div className="relative">
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500 pointer-events-none" />
                  <input
                    id="source-url"
                    type="text"
                    value={sourceUrl}
                    onChange={e => setSourceUrl(e.target.value)}
                    placeholder="github.com"
                    className="input-field pl-10"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>

              {/* qr content */}
              <div>
                <label className="label" htmlFor="qr-content">
                  QR Content <span className="text-ink-600 normal-case tracking-normal">(URL or text)</span>
                </label>
                <div className="relative">
                  <ChevronRight className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500 pointer-events-none" />
                  <input
                    id="qr-content"
                    type="text"
                    value={qrContent}
                    onChange={e => setQrContent(e.target.value)}
                    placeholder="https://github.com/yourrepo"
                    className="input-field pl-10"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={!sourceUrl.trim() || !qrContent.trim() || status === 'loading'}
                className="btn-primary"
              >
                {status === 'loading' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Extracting colors…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate QR
                  </>
                )}
              </button>
            </form>

            {/* error */}
            {status === 'error' && (
              <div className="bg-red-950/50 border border-red-900/60 rounded-xl p-4 text-sm text-red-300 font-mono animate-fade-up">
                {errorMsg}
              </div>
            )}

            {/* ── palette & color overrides (shown after generation) ── */}
            {status === 'done' && palette && (
              <div className="animate-fade-up space-y-5">
                <div className="section-divider" />

                {/* palette */}
                <div>
                  <p className="label mb-3">Extracted Palette</p>
                  <div className="flex flex-wrap gap-2">
                    {palette.all.map((color, i) => (
                      <button
                        key={i}
                        title={color}
                        onClick={() => setDotColor(color)}
                        className={`color-swatch ${dotColor === color ? 'swatch-selected' : ''}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] font-mono text-ink-600">
                    Click a swatch to use as dot color
                  </p>
                </div>

                {/* color pickers */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label" htmlFor="dot-color">Dot Color</label>
                    <div className="flex items-center gap-2">
                      <input
                        id="dot-color"
                        type="color"
                        value={dotColor}
                        onChange={e => setDotColor(e.target.value)}
                        className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border-0 p-0.5"
                      />
                      <span className="font-mono text-xs text-ink-400">{dotColor}</span>
                    </div>
                  </div>
                  <div>
                    <label className="label" htmlFor="bg-color">Background</label>
                    <div className="flex items-center gap-2">
                      <input
                        id="bg-color"
                        type="color"
                        value={bgColor}
                        onChange={e => setBgColor(e.target.value)}
                        className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border-0 p-0.5"
                      />
                      <span className="font-mono text-xs text-ink-400">{bgColor}</span>
                    </div>
                  </div>
                </div>

                <div className="section-divider" />

                {/* download + reset */}
                <div className="space-y-3">
                  <p className="label">Download</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => download('png')}
                      className="btn-secondary"
                    >
                      <Download className="w-4 h-4" />
                      PNG
                    </button>
                    <button
                      onClick={() => download('svg')}
                      className="btn-secondary"
                    >
                      <Download className="w-4 h-4" />
                      SVG
                    </button>
                  </div>

                  <button
                    onClick={reset}
                    className="w-full flex items-center justify-center gap-2 text-ink-500 hover:text-ink-300 text-sm font-mono transition-colors py-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Start over
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── right: QR preview ── */}
          <div className="flex flex-col items-center justify-center min-h-[500px] lg:sticky lg:top-8">

            {/*
              The ref div must ALWAYS be in the DOM — even when hidden — so
              qrContainerRef.current is never null when renderQR() runs.
              CSS `hidden` keeps the node in the DOM; it just sets display:none.
            */}
            <div className={status === 'done' ? 'relative animate-scale-in' : 'hidden'}>
              {/* dynamic glow */}
              <div
                className="qr-glow"
                style={{
                  background: `radial-gradient(ellipse, ${dotColor} 0%, ${bgColor} 55%, transparent 80%)`,
                  opacity: 0.2,
                }}
              />
              {/* favicon badge */}
              {favicon && (
                <div className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-ink-800 border-2 border-ink-700 flex items-center justify-center overflow-hidden z-20 shadow-lg">
                  <img src={favicon} alt="favicon" className="w-6 h-6 object-contain" />
                </div>
              )}
              {/* QR canvas — ref is valid even when parent is display:none */}
              <div
                ref={qrContainerRef}
                className="relative z-10 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-ink-700"
              />
            </div>

            {/* placeholder — only visible when QR isn't ready */}
            {status !== 'done' && (
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="relative w-[380px] h-[380px] rounded-2xl border border-dashed border-ink-700 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-2xl overflow-hidden opacity-20">
                    <svg width="100%" height="100%">
                      <defs>
                        <pattern id="dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                          <circle cx="10" cy="10" r="1.5" fill="#5C554B" />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#dots)" />
                    </svg>
                  </div>
                  <div className="flex flex-col items-center gap-3 z-10">
                    {status === 'loading' ? (
                      <>
                        <div className="w-16 h-16 rounded-2xl bg-ink-800 border border-ink-700 flex items-center justify-center">
                          <Loader2 className="w-7 h-7 text-amber animate-spin" />
                        </div>
                        <div className="space-y-1 text-center">
                          <p className="text-ink-300 font-sans text-sm font-medium">Fetching favicon…</p>
                          <p className="text-ink-600 font-mono text-xs">extracting color palette</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 rounded-2xl bg-ink-800 border border-ink-700 flex items-center justify-center">
                          <QrCode className="w-7 h-7 text-ink-600" />
                        </div>
                        <div className="space-y-1 text-center">
                          <p className="text-ink-500 font-sans text-sm">Your QR will appear here</p>
                          <p className="text-ink-700 font-mono text-xs">enter a URL and generate</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {status === 'idle' && (
                  <div className="flex items-center gap-6 mt-2">
                    {[['01', 'Enter URL'], ['02', 'Extract colors'], ['03', 'Download QR']].map(([n, label]) => (
                      <div key={n} className="flex items-center gap-2 text-ink-600">
                        <span className="font-mono text-[10px] text-amber">{n}</span>
                        <span className="font-sans text-xs">{label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ── footer ── */}
      <footer className="border-t border-ink-800 px-6 py-4 flex items-center justify-between text-ink-600 text-xs font-mono">
        <span>qraft</span>
        <span>100% client-side · no data stored</span>
      </footer>
    </div>
  );
}
