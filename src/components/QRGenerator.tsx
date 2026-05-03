import { useState, useRef, useCallback, useEffect } from "react";
import {
  Download,
  Sparkles,
  Loader2,
  Link2,
  QrCode,
  RotateCcw,
  ChevronRight,
  Layers,
} from "lucide-react";
import {
  generateArtisticQR,
  generateArtisticQRSVG,
} from "../lib/generateArtisticQR";
import AmbientGradient from "./AmbientGradient";

/* ─── helpers ─────────────────────────────────────────── */

function rgbToHex([r, g, b]: number[]): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function getLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : "https://" + url);
    return u.hostname;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function normalizeUrl(url: string): string {
  if (!url) return "";
  return url.startsWith("http") ? url : "https://" + url;
}

function maybeNormalizeUrl(content: string): string {
  if (!content) return "";
  if (content.startsWith("http://") || content.startsWith("https://"))
    return content;
  // Only prepend https:// if it looks like a bare domain (no spaces, has a dot)
  if (!content.includes(" ") && content.includes("."))
    return "https://" + content;
  return content;
}

/* ─── types ───────────────────────────────────────────── */

type Status = "idle" | "loading" | "done" | "error";
type QRMode = "center" | "artistic";

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
  size = 380,
) {
  const margin = Math.round(size * 0.025); // 2.5%, same as artistic mode
  return {
    width: size,
    height: size,
    type: "canvas" as const,
    data,
    ...(imageUrl ? { image: imageUrl } : {}),
    margin,
    qrOptions: { errorCorrectionLevel: "H" as const },
    dotsOptions: {
      color: dotColor,
      type: "dots" as const,
      roundSize: false,
    } as any,
    backgroundOptions: { color: bgColor, round: 0 },
    ...(imageUrl
      ? {
          imageOptions: {
            crossOrigin: "anonymous",
            margin: 6,
            imageSize: 0.3,
            hideBackgroundDots: true,
          },
        }
      : {}),
    cornersSquareOptions: { type: "extra-rounded" as const, color: dotColor },
    cornersDotOptions: { type: "dot" as const, color: dotColor },
  };
}

/* ─── component ───────────────────────────────────────── */

export default function QRGenerator() {
  const [sourceUrl, setSourceUrl] = useState("");
  const [qrContent, setQrContent] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [favicon, setFavicon] = useState<string | null>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [dotColor, setDotColor] = useState("#1c1712");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [qrMode, setQrMode] = useState<QRMode>("center");
  const [scrolled, setScrolled] = useState(false);

  const qrContainerRef = useRef<HTMLDivElement>(null);
  const qrInstanceRef = useRef<any>(null);
  const colorUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const faviconBlobRef = useRef<string | null>(null);
  const artCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  /* render / re-render QR */
  const renderQR = useCallback(
    async (
      data: string,
      imgUrl: string | null,
      dots: string,
      bg: string,
      mode: QRMode,
    ) => {
      if (!qrContainerRef.current) return;
      qrContainerRef.current.innerHTML = "";
      qrInstanceRef.current = null;
      artCanvasRef.current = null;

      if (mode === "artistic") {
        const canvas = await generateArtisticQR({
          text: data,
          faviconUrl: imgUrl,
          dotColor: dots,
          bgColor: bg,
          canvasSize: 380,
        });
        artCanvasRef.current = canvas;
        qrContainerRef.current.appendChild(canvas);
      } else {
        const { default: QRCodeStyling } = await import("qr-code-styling");
        const qr = new QRCodeStyling(buildQROptions(data, imgUrl, dots, bg));
        qr.append(qrContainerRef.current);
        qrInstanceRef.current = qr;
      }
    },
    [],
  );

  /* main generation flow */
  const generate = useCallback(async () => {
    const src = sourceUrl.trim();
    const content = qrContent.trim();
    if (!src || !content) return;

    setStatus("loading");
    setErrorMsg("");

    const domain = extractDomain(src);
    const googleFaviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=256`;
    const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(googleFaviconUrl)}&output=png&w=256&h=256`;

    let dots = "#1c1712";
    let bg = "#ffffff";
    let allColors: string[] = [dots, bg];
    let qrImageUrl: string | null = null;

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = wsrvUrl;
      await new Promise<void>((res, rej) => {
        const timer = setTimeout(() => rej(new Error("timeout")), 8000);
        img.onload = () => {
          clearTimeout(timer);
          res();
        };
        img.onerror = () => {
          clearTimeout(timer);
          rej(new Error("image load failed"));
        };
      });

      const { default: ColorThiefCtor } = await import("colorthief");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ct = new (ColorThiefCtor as any)();
      const raw = ct.getPalette(img, 8, 1) as number[][];
      const extracted = raw.map(rgbToHex);

      /* background: only use palette color if genuinely light */
      let lightestLum = -1,
        lightestColor = "#ffffff";
      for (const hex of extracted) {
        const lum = getLuminance(hex);
        if (lum > lightestLum) {
          lightestLum = lum;
          lightestColor = hex;
        }
      }
      bg = lightestLum > 0.7 ? lightestColor : "#ffffff";
      const bgLum = getLuminance(bg);

      /* build usable palette: sort by contrast, filter low-contrast, dedupe, max 4 */
      const byContrast = [...extracted].sort(
        (a, b) =>
          Math.abs(getLuminance(b) - bgLum) - Math.abs(getLuminance(a) - bgLum),
      );
      const usable: string[] = [];
      for (const hex of byContrast) {
        if (usable.length >= 4) break;
        if (Math.abs(getLuminance(hex) - bgLum) < 0.25) continue;
        if (
          usable.some(
            (f) => Math.abs(getLuminance(f) - getLuminance(hex)) < 0.08,
          )
        )
          continue;
        usable.push(hex);
      }
      for (const hex of byContrast) {
        if (usable.length >= 2) break;
        if (!usable.includes(hex)) usable.push(hex);
      }

      allColors = usable;
      dots = usable[0];

      if (Math.abs(getLuminance(dots) - bgLum) < 0.15) {
        bg = getLuminance(dots) < 0.5 ? "#ffffff" : "#1c1712";
      }

      qrImageUrl = wsrvUrl;
    } catch {
      /* color extraction failed — use defaults */
    }

    faviconBlobRef.current = qrImageUrl;
    setFavicon(wsrvUrl);
    setDotColor(dots);
    setBgColor(bg);
    setPalette({ dominant: dots, background: bg, all: allColors });

    try {
      await renderQR(maybeNormalizeUrl(content), qrImageUrl, dots, bg, qrMode);
      setStatus("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setErrorMsg(
        msg.toLowerCase().includes("overflow") ||
          msg.toLowerCase().includes("length")
          ? "El contenido del QR es demasiado largo. Acorta el texto e inténtalo de nuevo."
          : "No se pudo generar el código QR. Inténtalo de nuevo.",
      );
      setStatus("error");
    }
  }, [sourceUrl, qrContent, renderQR, qrMode]);

  /* scroll-aware navbar via IntersectionObserver */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  /* re-render when colors or mode change */
  useEffect(() => {
    if (status !== "done") return;
    if (colorUpdateTimer.current) clearTimeout(colorUpdateTimer.current);
    colorUpdateTimer.current = setTimeout(
      () => {
        renderQR(
          maybeNormalizeUrl(qrContent),
          faviconBlobRef.current,
          dotColor,
          bgColor,
          qrMode,
        );
      },
      qrMode === "artistic" ? 0 : 300,
    );
    return () => {
      if (colorUpdateTimer.current) clearTimeout(colorUpdateTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- qrContent y faviconBlobRef excluidos deliberadamente; efecto solo para cambios visuales
  }, [dotColor, bgColor, qrMode]);

  /* download */
  const download = useCallback(
    async (fmt: "png" | "svg") => {
      if (!qrContent) return;

      if (qrMode === "artistic") {
        if (fmt === "png") {
          // Regenerate at 1024px — the preview canvas is only 380px
          const hiRes = await generateArtisticQR({
            text: maybeNormalizeUrl(qrContent),
            faviconUrl: faviconBlobRef.current,
            dotColor,
            bgColor,
            canvasSize: 1024,
          });
          hiRes.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "qraft-qr.png";
            a.click();
            URL.revokeObjectURL(url);
          }, "image/png");
        } else if (fmt === "svg") {
          const svg = await generateArtisticQRSVG({
            text: maybeNormalizeUrl(qrContent),
            faviconUrl: faviconBlobRef.current,
            dotColor,
            bgColor,
            canvasSize: 1000,
          });
          const blob = new Blob([svg], { type: "image/svg+xml" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "qraft-qr.svg";
          a.click();
          URL.revokeObjectURL(url);
        }
        return;
      }

      if (fmt === "png") {
        // Regenerate at 1024px — the preview instance is only 380px
        const { default: QRCodeStyling } = await import("qr-code-styling");
        const hiRes = new QRCodeStyling(
          buildQROptions(
            maybeNormalizeUrl(qrContent),
            faviconBlobRef.current,
            dotColor,
            bgColor,
            1024,
          ),
        );
        await hiRes.download({ name: "qraft-qr", extension: "png" });
        return;
      }
      const { default: QRCodeStyling } = await import("qr-code-styling");
      const svgQr = new QRCodeStyling({
        ...buildQROptions(
          maybeNormalizeUrl(qrContent),
          faviconBlobRef.current,
          dotColor,
          bgColor,
          1024,
        ),
        type: "svg" as const,
      });
      await svgQr.download({ name: "qraft-qr", extension: "svg" });
    },
    [qrContent, qrMode, dotColor, bgColor],
  );

  const reset = () => {
    setStatus("idle");
    setFavicon(null);
    setPalette(null);
    setDotColor("#1c1712");
    setBgColor("#ffffff");
    setErrorMsg("");
    faviconBlobRef.current = null;
    artCanvasRef.current = null;
    if (qrContainerRef.current) qrContainerRef.current.innerHTML = "";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    generate();
  };

  /* ─── render ─────────────────────────────────────────── */
  const showPalette = status === "done" && !!palette;

  return (
    <div className="min-h-screen flex flex-col">
      {/* sentinel: 1px invisible — cuando sale del viewport → navbar se vuelve sólida */}
      <div
        ref={sentinelRef}
        className="absolute top-0 h-px w-full pointer-events-none"
        aria-hidden="true"
      />

      <AmbientGradient colors={palette?.all ?? null} />

      {/* ── nav ── */}
      <header
        className={`sticky top-0 z-10 px-8 pb-6 flex items-center justify-between border-b transition-colors duration-300 ${
          scrolled
            ? "bg-white/80 backdrop-blur-md border-ink-200"
            : "bg-transparent border-transparent"
        }`}
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.5rem)" }}
      >
        <span className="font-display text-3xl font-semibold italic tracking-tight text-ink-900">
          qraft
        </span>
        <span className="hidden sm:block text-[13px] font-mono tracking-widest uppercase text-ink-600">
          generador de QR con identidad de marca
        </span>
      </header>

      {/* ── wrapper vertical centering ── */}
      <main className="flex-1 flex flex-col justify-center gap-10 py-10">
        {/* ── hero ── */}
        <section
          className={`px-6 text-center overflow-hidden hero-section${status === "done" ? " hero-section-shifted" : ""}`}
        >
          <h1 className="font-display italic leading-[0.88] tracking-tight select-none">
            <span
              className="block text-5xl sm:text-7xl lg:text-8xl font-light text-stroke animate-fade-up"
              style={{ animationDelay: "0ms" }}
            >
              Códigos QR
            </span>
            <span
              className="block text-5xl sm:text-7xl lg:text-8xl font-semibold text-ink-900 animate-fade-up"
              style={{ animationDelay: "80ms" }}
            >
              con tu marca.
            </span>
          </h1>
        </section>

        {/* ── main content ── */}
        <div className="px-4 sm:px-6 max-w-[900px] mx-auto w-full overflow-x-clip">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:items-stretch">
            {/* ── left panel ── */}
            <div className="bg-white border border-ink-200 rounded-2xl p-6 flex flex-col gap-6 shadow-sm h-full">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label" htmlFor="source-url">
                    URL del sitio web{" "}
                    <span className="text-ink-400 normal-case tracking-normal">
                      (para colores y favicon)
                    </span>
                  </label>
                  <div className="relative">
                    <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
                    <input
                      id="source-url"
                      type="text"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      placeholder="spotify.com"
                      className="input-field pl-10"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                </div>

                <div>
                  <label className="label" htmlFor="qr-content">
                    Contenido del QR{" "}
                    <span className="text-ink-400 normal-case tracking-normal">
                      (URL o texto)
                    </span>
                  </label>
                  <div className="relative">
                    <ChevronRight className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
                    <input
                      id="qr-content"
                      type="text"
                      value={qrContent}
                      onChange={(e) => setQrContent(e.target.value)}
                      placeholder="https://spotify.com/playlist"
                      className="input-field pl-10"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                </div>

                {/* Mode selector */}
                <div>
                  <p className="label mb-2">Estilo</p>
                  <div
                    className="grid grid-cols-2 gap-2"
                    role="group"
                    aria-label="Estilo del QR"
                  >
                    {(
                      [
                        {
                          value: "center",
                          icon: <QrCode className="w-4 h-4" />,
                          label: "Favicon en el centro",
                        },
                        {
                          value: "artistic",
                          icon: <Layers className="w-4 h-4" />,
                          label: "Favicon como puntos",
                        },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={qrMode === opt.value}
                        onClick={() => setQrMode(opt.value)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-mono transition-all duration-150
                        ${
                          qrMode === opt.value
                            ? "bg-caoba/10 border-caoba text-caoba"
                            : "bg-ink-50 border-ink-200 text-ink-500 hover:border-ink-300 hover:text-ink-800"
                        }`}
                      >
                        {opt.icon}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={
                    !sourceUrl.trim() ||
                    !qrContent.trim() ||
                    status === "loading"
                  }
                  className="btn-primary"
                >
                  {status === "loading" ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Extrayendo colores…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generar QR
                    </>
                  )}
                </button>
              </form>

              {status === "error" && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 font-mono animate-fade-up">
                  {errorMsg}
                </div>
              )}

              {/* ── palette & controls — height animated via max-height transition ── */}
              <div
                style={{
                  maxHeight: showPalette ? "900px" : "0",
                  opacity: showPalette ? 1 : 0,
                  overflow: "hidden",
                  visibility: showPalette ? "visible" : "hidden",
                  transition: showPalette
                    ? "max-height 0.55s cubic-bezier(0.16,1,0.3,1), opacity 0.3s ease, visibility 0s"
                    : "max-height 0.55s cubic-bezier(0.16,1,0.3,1), opacity 0.3s ease, visibility 0s 0.55s",
                }}
              >
                <div className="space-y-5">
                  <div className="section-divider" />

                  <div>
                    <p className="label mb-3">Paleta extraída</p>
                    <div className="flex flex-wrap gap-3">
                      {palette?.all.map((color, i) => (
                        <button
                          key={i}
                          title={color}
                          aria-label={`Usar ${color} como color de puntos`}
                          aria-pressed={dotColor === color}
                          onClick={() => setDotColor(color)}
                          className={`color-swatch ${dotColor === color ? "swatch-selected" : ""}`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <p className="mt-2 text-[10px] font-mono text-ink-400">
                      Haz clic en un color para usarlo en los puntos
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label" htmlFor="dot-color">
                        Color puntos
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id="dot-color"
                          type="color"
                          value={dotColor}
                          onChange={(e) => setDotColor(e.target.value)}
                          className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border-0 p-0.5"
                        />
                        <span className="font-mono text-xs text-ink-500">
                          {dotColor}
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="label" htmlFor="bg-color">
                        Fondo
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id="bg-color"
                          type="color"
                          value={bgColor}
                          onChange={(e) => setBgColor(e.target.value)}
                          className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border-0 p-0.5"
                        />
                        <span className="font-mono text-xs text-ink-500">
                          {bgColor}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="section-divider" />

                  <div className="space-y-3">
                    <p className="label">Descargar</p>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => download("png")}
                        className="btn-secondary"
                      >
                        <Download className="w-4 h-4" />
                        PNG
                      </button>
                      <button
                        onClick={() => download("svg")}
                        className="btn-secondary"
                      >
                        <Download className="w-4 h-4" />
                        SVG
                      </button>
                    </div>
                    <button
                      onClick={reset}
                      className="w-full flex items-center justify-center gap-2 text-ink-400 hover:text-ink-700 text-sm font-mono transition-colors py-1"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Empezar de nuevo
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── right: QR preview ── */}
            <div className="flex flex-col items-center justify-center h-full">
              <div
                className={
                  status === "done"
                    ? "relative animate-scale-in w-full max-w-[380px]"
                    : "hidden"
                }
              >
                <div
                  className="qr-glow"
                  style={{
                    background: `radial-gradient(ellipse, ${dotColor} 0%, ${bgColor} 55%, transparent 80%)`,
                  }}
                />
                {favicon && (
                  <div className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-white border-2 border-ink-200 flex items-center justify-center overflow-hidden z-20 shadow-md">
                    <img
                      src={favicon}
                      alt="favicon"
                      className="w-6 h-6 object-contain"
                    />
                  </div>
                )}
                <div
                  ref={qrContainerRef}
                  className="qr-canvas-wrapper relative z-10 rounded-2xl overflow-hidden shadow-lg ring-1 ring-ink-200"
                />
              </div>

              {/* placeholder */}
              {status !== "done" && (
                <div className="relative w-full max-w-[380px] aspect-square rounded-2xl border border-dashed border-ink-300 flex items-center justify-center bg-white/50">
                  <div className="absolute inset-0 rounded-2xl overflow-hidden opacity-25">
                    <svg width="100%" height="100%">
                      <defs>
                        <pattern
                          id="dots"
                          x="0"
                          y="0"
                          width="20"
                          height="20"
                          patternUnits="userSpaceOnUse"
                        >
                          <circle cx="10" cy="10" r="1.5" fill="#C8C0B8" />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#dots)" />
                    </svg>
                  </div>
                  <div className="flex flex-col items-center gap-3 z-10">
                    {status === "loading" ? (
                      <>
                        <div className="w-16 h-16 rounded-2xl bg-ink-100 border border-ink-200 flex items-center justify-center">
                          <Loader2 className="w-7 h-7 text-caoba animate-spin" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-ink-700 font-sans text-sm font-medium">
                            Obteniendo favicon…
                          </p>
                          <p className="text-ink-400 font-mono text-xs">
                            extrayendo paleta de colores
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 rounded-2xl bg-ink-100 border border-ink-200 flex items-center justify-center">
                          <QrCode className="w-7 h-7 text-ink-400" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-ink-600 font-sans text-sm">
                            Tu QR aparecerá aquí
                          </p>
                          <p className="text-ink-400 font-mono text-xs">
                            introduce una URL y genera
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* step indicators — outside grid so no height contribution */}
          {status === "idle" && (
            <div className="flex items-center justify-center gap-8 mt-6">
              {[
                ["01", "Introduce URL"],
                ["02", "Extrae colores"],
                ["03", "Descarga el QR"],
              ].map(([n, label]) => (
                <div key={n} className="flex items-center gap-2 text-ink-500">
                  <span className="font-mono text-[10px] text-caoba">{n}</span>
                  <span className="font-sans text-xs">{label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
      {/* end vertical centering wrapper */}

      {/* ── footer ── */}
      <footer className="border-t border-ink-200 px-8 py-7 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="font-display text-lg italic font-semibold tracking-tight text-ink-900">
            qraft
          </span>
          <span className="text-ink-500">·</span>
          <span className="text-[13px] font-mono text-ink-600">
            100% en cliente · sin almacenamiento · favicon vía Google y wsrv.nl
          </span>
        </div>
        <a
          href="https://lostal.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-1 text-[13px] font-mono text-ink-600 hover:text-[#d3bb3f] transition-colors duration-150"
        >
          Hecho por Álvaro Lostal
          <span className="inline-block group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-150">
            ↗
          </span>
        </a>
      </footer>
    </div>
  );
}
