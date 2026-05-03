import { useEffect, useRef } from 'react';

/* ─── GLSL ──────────────────────────────────────────────── */

const VERT = `
attribute vec2 a_pos;
varying vec2 vUv;
void main(){
  vUv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform float uTime;
uniform vec2 uRes;
uniform vec3 uC1,uC2,uC3,uC4,uC5,uC6;
uniform float uSpeed,uIntensity,uGrain,uGradSize;
uniform sampler2D uTouch;
uniform vec3 uBg;
varying vec2 vUv;
#define PI 3.14159265

float noise(vec2 uv, float t){
  vec2 g = uv * uRes * 0.5;
  return fract(sin(dot(g + t, vec2(12.9898, 78.233))) * 43758.5453) * 2.0 - 1.0;
}

vec3 grad(vec2 uv, float t){
  float r = uGradSize;
  float s = uSpeed;
  vec2 c1 = vec2(0.5+sin(t*s*0.40)*0.40, 0.5+cos(t*s*0.50)*0.40);
  vec2 c2 = vec2(0.5+cos(t*s*0.60)*0.50, 0.5+sin(t*s*0.45)*0.50);
  vec2 c3 = vec2(0.5+sin(t*s*0.35)*0.45, 0.5+cos(t*s*0.55)*0.45);
  vec2 c4 = vec2(0.5+cos(t*s*0.50)*0.40, 0.5+sin(t*s*0.40)*0.40);
  vec2 c5 = vec2(0.5+sin(t*s*0.70)*0.35, 0.5+cos(t*s*0.60)*0.35);
  vec2 c6 = vec2(0.5+cos(t*s*0.45)*0.50, 0.5+sin(t*s*0.65)*0.50);

  float i1 = 1.0 - smoothstep(0.0, r, length(uv - c1));
  float i2 = 1.0 - smoothstep(0.0, r, length(uv - c2));
  float i3 = 1.0 - smoothstep(0.0, r, length(uv - c3));
  float i4 = 1.0 - smoothstep(0.0, r, length(uv - c4));
  float i5 = 1.0 - smoothstep(0.0, r, length(uv - c5));
  float i6 = 1.0 - smoothstep(0.0, r, length(uv - c6));

  vec2 rv1 = uv - 0.5;
  float a1 = t * s * 0.15;
  rv1 = vec2(rv1.x*cos(a1) - rv1.y*sin(a1), rv1.x*sin(a1) + rv1.y*cos(a1)) + 0.5;
  vec2 rv2 = uv - 0.5;
  float a2 = -t * s * 0.12;
  rv2 = vec2(rv2.x*cos(a2) - rv2.y*sin(a2), rv2.x*sin(a2) + rv2.y*cos(a2)) + 0.5;
  float ri1 = 1.0 - smoothstep(0.0, 0.8, length(rv1 - 0.5));
  float ri2 = 1.0 - smoothstep(0.0, 0.8, length(rv2 - 0.5));

  vec3 col = vec3(0.0);
  col += uC1 * i1 * (0.55 + 0.45*sin(t*s));
  col += uC2 * i2 * (0.55 + 0.45*cos(t*s*1.2));
  col += uC3 * i3 * (0.55 + 0.45*sin(t*s*0.8));
  col += uC4 * i4 * (0.55 + 0.45*cos(t*s*1.3));
  col += uC5 * i5 * (0.55 + 0.45*sin(t*s*1.1));
  col += uC6 * i6 * (0.55 + 0.45*cos(t*s*0.9));
  col += mix(uC1, uC3, ri1) * 0.28;
  col += mix(uC2, uC4, ri2) * 0.22;

  col = clamp(col, 0.0, 1.0) * uIntensity;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 1.2);
  col = pow(col, vec3(0.92));

  // mezclar con el color de fondo en zonas sin blob
  float br = length(col);
  col = mix(uBg, col, clamp(br * 1.5, 0.0, 1.0));
  return col;
}

void main(){
  vec2 uv = vUv;

  // distorsión por toque/ratón
  vec4 touch = texture2D(uTouch, uv);
  float vx = -(touch.r * 2.0 - 1.0);
  float vy = -(touch.g * 2.0 - 1.0);
  float ti = touch.b;
  uv.x += vx * 0.5 * ti;
  uv.y += vy * 0.5 * ti;
  float d = length(uv - 0.5);
  uv += vec2(sin(d * 20.0 - uTime * 3.0) * 0.025 * ti);

  vec3 col = grad(uv, uTime);
  col += noise(uv, uTime) * uGrain;

  // ligero desplazamiento cromático con el tiempo
  float ts = uTime * 0.5;
  col.r += sin(ts) * 0.01;
  col.g += cos(ts * 1.4) * 0.01;
  col.b += sin(ts * 1.2) * 0.01;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/* ─── utilidades ────────────────────────────────────────── */

type Vec3 = [number, number, number];

function hexToVec3(hex: string): Vec3 {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

function buildProgram(gl: WebGLRenderingContext, vs: string, fs: string) {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  return p;
}

/* ─── defaults ──────────────────────────────────────────── */

// grises neutros cálidos: sin tinte de color, monocromático sobre el fondo crema
const DEFAULTS = ['#d4d0cb', '#bfbbb6', '#e0dbd6', '#b4b0ab', '#cac6c1', '#d8d4cf'];
const BG: Vec3 = [245 / 255, 240 / 255, 234 / 255]; // #F5F0EA — mismo que body bg

/* ─── componente ────────────────────────────────────────── */

interface Props { colors: string[] | null; }

export default function AmbientGradient({ colors }: Props) {
  const targetRef  = useRef<Vec3[]>(DEFAULTS.map(hexToVec3));
  const currentRef = useRef<Vec3[]>(DEFAULTS.map(hexToVec3));

  // actualizar colores objetivo cuando cambia la paleta
  useEffect(() => {
    const src = colors && colors.length > 0 ? colors : DEFAULTS;
    targetRef.current = Array.from({ length: 6 }, (_, i) => hexToVec3(src[i % src.length]));
  }, [colors]);

  // setup WebGL (solo una vez)
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* canvas montado directamente en body para evitar problemas de stacking context */
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '-1',
      pointerEvents: 'none',
      opacity: '0.45',
      width: '100%',
      height: '100%',
    });
    document.body.insertBefore(canvas, document.body.firstChild);

    const gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false });
    if (!gl) { canvas.remove(); return; }

    const prog = buildProgram(gl, VERT, FRAG);
    gl.useProgram(prog);

    // quad de pantalla completa
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // uniform locations
    const uloc = {
      time:      gl.getUniformLocation(prog, 'uTime'),
      res:       gl.getUniformLocation(prog, 'uRes'),
      speed:     gl.getUniformLocation(prog, 'uSpeed'),
      intensity: gl.getUniformLocation(prog, 'uIntensity'),
      grain:     gl.getUniformLocation(prog, 'uGrain'),
      gradSize:  gl.getUniformLocation(prog, 'uGradSize'),
      touch:     gl.getUniformLocation(prog, 'uTouch'),
      bg:        gl.getUniformLocation(prog, 'uBg'),
      c: ([1,2,3,4,5,6] as const).map(i => gl.getUniformLocation(prog, `uC${i}`)),
    };

    // uniforms estáticos
    gl.uniform1f(uloc.speed,     0.45);  // más lento que el original (1.2) para sutileza
    gl.uniform1f(uloc.intensity, 0.85);  // original usa 1.8
    gl.uniform1f(uloc.grain,     0.03);  // grain ligero (ya hay grano CSS en body::after)
    gl.uniform1f(uloc.gradSize,  0.72);  // blobs grandes y difusos
    gl.uniform3fv(uloc.bg,       BG);
    gl.uniform1i(uloc.touch,     0);

    /* ── touch texture ── */
    const TT = 64;
    const ttCanvas = document.createElement('canvas');
    ttCanvas.width = ttCanvas.height = TT;
    const ttCtx = ttCanvas.getContext('2d')!;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE);
    ttCtx.fillStyle = 'black';
    ttCtx.fillRect(0, 0, TT, TT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ttCanvas);

    type TrailPt = { x: number; y: number; age: number; force: number; vx: number; vy: number };
    const trail: TrailPt[] = [];
    const TT_MAX    = 64;
    const TT_RADIUS = 0.25 * TT;
    const TT_SPEED  = 1 / TT_MAX;
    let lastTouch: { x: number; y: number } | null = null;

    const addTouch = (x: number, y: number) => {
      let force = 0, vx = 0, vy = 0;
      if (lastTouch) {
        const dx = x - lastTouch.x, dy = y - lastTouch.y;
        if (dx === 0 && dy === 0) return;
        const dist = Math.sqrt(dx * dx + dy * dy);
        vx = dx / dist; vy = dy / dist;
        force = Math.min((dx * dx + dy * dy) * 20000, 2.0);
      }
      lastTouch = { x, y };
      trail.push({ x, y, age: 0, force, vx, vy });
    };

    const updateTouch = () => {
      ttCtx.fillStyle = 'black';
      ttCtx.fillRect(0, 0, TT, TT);
      for (let i = trail.length - 1; i >= 0; i--) {
        const p = trail[i];
        const f = p.force * TT_SPEED * (1 - p.age / TT_MAX);
        p.x += p.vx * f;
        p.y += p.vy * f;
        p.age++;
        if (p.age > TT_MAX) { trail.splice(i, 1); continue; }
        let intensity: number;
        if (p.age < TT_MAX * 0.3) {
          intensity = Math.sin((p.age / (TT_MAX * 0.3)) * (Math.PI / 2));
        } else {
          const t = 1 - (p.age - TT_MAX * 0.3) / (TT_MAX * 0.7);
          intensity = -t * (t - 2);
        }
        intensity *= p.force;
        const px = p.x * TT;
        const py = (1 - p.y) * TT;
        const cr = ((p.vx + 1) / 2 * 255) | 0;
        const cg = ((p.vy + 1) / 2 * 255) | 0;
        const cb = (intensity * 255) | 0;
        const offset = TT * 5;
        ttCtx.shadowOffsetX = offset;
        ttCtx.shadowOffsetY = offset;
        ttCtx.shadowBlur    = TT_RADIUS;
        ttCtx.shadowColor   = `rgba(${cr},${cg},${cb},${0.2 * intensity})`;
        ttCtx.beginPath();
        ttCtx.fillStyle = 'rgba(255,0,0,1)';
        ttCtx.arc(px - offset, py - offset, TT_RADIUS, 0, Math.PI * 2);
        ttCtx.fill();
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ttCanvas);
    };

    /* resize */
    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uloc.res, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    /* eventos de ratón/toque */
    const onMouse = (e: MouseEvent) =>
      addTouch(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight);
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      addTouch(t.clientX / window.innerWidth, 1 - t.clientY / window.innerHeight);
    };
    if (!prefersReduced) {
      window.addEventListener('mousemove', onMouse);
      window.addEventListener('touchmove', onTouchMove, { passive: true });
    }

    /* render loop */
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    let elapsed = 0;
    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (!prefersReduced) elapsed += dt;

      // interpolar colores actuales hacia el objetivo (~2s de transición a 60fps)
      const cur = currentRef.current;
      const tgt = targetRef.current;
      for (let i = 0; i < 6; i++) {
        cur[i] = [lerp(cur[i][0], tgt[i][0], 0.03), lerp(cur[i][1], tgt[i][1], 0.03), lerp(cur[i][2], tgt[i][2], 0.03)] as Vec3;
        gl.uniform3fv(uloc.c[i], cur[i]);
      }

      updateTouch();
      gl.uniform1f(uloc.time, elapsed);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('touchmove', onTouchMove);
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
      gl.deleteTexture(tex);
      canvas.remove();
    };
  }, []);

  return null;
}
