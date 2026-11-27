/**
 * Efeito luminoso radial ("update beam") inspirado no `theme-sweep` do OpenBot.
 *
 * Quando uma atualização é detectada/iniciada (`"in"`), um anel de luz orgânico
 * converge das bordas da janela até o botão de atualização. Ao clicar para
 * atualizar ou reiniciar (`"out"`), a onda irradia do botão para a tela toda.
 */

const BEAM_IN_MS = 1350;
const BEAM_OUT_MS = 1150;
const BEAM_DEADLINE_MS = 2800;
const BEAM_SPREAD = 0.55;
const BEAM_ALPHA = 0.72;
const BEHIND = 0.34;
const AHEAD = 0.14;
const MAX_PIXEL_RATIO = 1;

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_radius;
uniform float u_progress;
uniform float u_time;
uniform vec2 u_origin;
uniform float u_spread;
uniform float u_alpha;
const float AHEAD = ${AHEAD.toFixed(3)};
const float BEHIND = ${BEHIND.toFixed(3)};

vec3 spectrum(float t) {
  // Paleta CriativoOS (Volt #B9FC01 -> Emerald #31CF76 -> Cobalt/Cyan)
  return vec3(0.56, 0.76, 0.72) + vec3(0.44, 0.24, 0.42) * cos(6.28318 * (t + vec3(0.85, 0.18, 0.52)));
}

vec3 washColor(float t) {
  return spectrum(t) * 0.5 + spectrum(t - 0.18) * 0.25 + spectrum(t + 0.18) * 0.25;
}

void main() {
  vec2 p = (gl_FragCoord.xy - u_origin) / u_resolution.y;
  float t = u_time;
  float angle = atan(p.y, p.x);
  float ring = u_radius * (1.0 + 0.08 * sin(angle * 5.0 - t * 3.2) + 0.04 * sin(angle * 11.0 + t * 4.1)
    + 0.02 * sin(angle * 23.0 - t * 5.3));
  float s = length(p) - ring;
  float reach = (s > 0.0 ? AHEAD : BEHIND) * u_spread;
  float alpha = exp(-(s * s) / (reach * reach)) * u_alpha;
  float around = 0.3 * smoothstep(0.05, 0.4, u_radius) * sin(angle * 3.0 + t * 1.5);

  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 warp = uv + 0.08 * vec2(sin(uv.y * 5.0 + t * 1.7), sin(uv.x * 6.0 - t * 2.1));
  float hue = u_progress * 0.75 + s * 0.9 + around + 0.1 * sin(warp.x * 7.0 + warp.y * 4.0 + t * 2.0);
  vec3 color = clamp(washColor(hue), 0.0, 1.0);
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

function easeInOut(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

interface BeamRenderer {
  canvas: HTMLCanvasElement;
  draw(radius: number, progress: number, seconds: number, alpha: number): void;
  dispose(): void;
}

function createBeamRenderer(originX: number, originY: number): BeamRenderer | null {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    pointerEvents: "none",
    zIndex: "9999",
  });

  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  canvas.width = Math.max(1, Math.round(window.innerWidth * ratio));
  canvas.height = Math.max(1, Math.round(window.innerHeight * ratio));

  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true });
  if (gl) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (vertex && fragment && program) {
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, "a_position");
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(gl.getUniformLocation(program, "u_resolution"), canvas.width, canvas.height);
        gl.uniform2f(gl.getUniformLocation(program, "u_origin"), originX * ratio, (window.innerHeight - originY) * ratio);
        gl.uniform1f(gl.getUniformLocation(program, "u_spread"), BEAM_SPREAD);

        const radiusUniform = gl.getUniformLocation(program, "u_radius");
        const progressUniform = gl.getUniformLocation(program, "u_progress");
        const timeUniform = gl.getUniformLocation(program, "u_time");
        const alphaUniform = gl.getUniformLocation(program, "u_alpha");

        return {
          canvas,
          draw(radius, progress, seconds, alpha) {
            gl.uniform1f(radiusUniform, radius);
            gl.uniform1f(alphaUniform, alpha);
            gl.uniform1f(progressUniform, progress);
            gl.uniform1f(timeUniform, seconds);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          },
          dispose() {
            canvas.remove();
            gl.getExtension("WEBGL_lose_context")?.loseContext();
          },
        };
      }
    }
  }

  // Fallback Canvas 2D quando WebGL não estiver disponível
  const ctx2d = canvas.getContext("2d");
  if (!ctx2d) return null;
  return {
    canvas,
    draw(radius, _progress, _seconds, alpha) {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      if (alpha <= 0.005) return;
      const rPx = Math.max(8, radius * canvas.height);
      const inner = Math.max(0, rPx - 140 * ratio);
      const outer = rPx + 70 * ratio;
      const grad = ctx2d.createRadialGradient(
        originX * ratio,
        originY * ratio,
        inner,
        originX * ratio,
        originY * ratio,
        outer
      );
      grad.addColorStop(0, "rgba(0, 49, 204, 0)");
      grad.addColorStop(0.55, `rgba(49, 207, 118, ${(alpha * 0.55).toFixed(3)})`);
      grad.addColorStop(0.78, `rgba(185, 252, 1, ${(alpha * 0.85).toFixed(3)})`);
      grad.addColorStop(1, "rgba(185, 252, 1, 0)");
      ctx2d.fillStyle = grad;
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    },
    dispose() {
      canvas.remove();
    },
  };
}

let stopActiveBeam: (() => void) | undefined;

export function triggerUpdateBeam(
  origin: Element | null,
  direction: "in" | "out"
): Promise<void> {
  stopActiveBeam?.();
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve();
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
    return Promise.resolve();
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  if (width <= 0 || height <= 0) {
    return Promise.resolve();
  }

  const rect = origin?.getBoundingClientRect();
  const x = rect && rect.width > 0 ? rect.left + rect.width / 2 : 120;
  const y = rect && rect.height > 0 ? rect.top + rect.height / 2 : Math.max(80, height - 120);

  const renderer = createBeamRenderer(x, y);
  if (!renderer) {
    return Promise.resolve();
  }

  const corner = Math.max(
    Math.hypot(x, y),
    Math.hypot(width - x, y),
    Math.hypot(x, height - y),
    Math.hypot(width - x, height - y)
  );
  const endRadius = (corner / height + 2 * BEHIND * BEAM_SPREAD) / 0.86;
  const durationMs = direction === "out" ? BEAM_OUT_MS : BEAM_IN_MS;

  let frame = 0;
  let deadline = 0;
  let resolveDone = () => {};
  const donePromise = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const stop = () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(deadline);
    renderer.dispose();
    if (stopActiveBeam === stop) {
      stopActiveBeam = undefined;
    }
    resolveDone();
  };
  stopActiveBeam = stop;

  let start: number | undefined;
  const tick = (now: number) => {
    start ??= now;
    const elapsed = Math.max(0, now - start);
    const progress = Math.min(1, elapsed / durationMs);
    const forward = direction === "out" ? progress : 1 - progress;
    const reach = easeInOut(forward);
    const radius = Math.max(0.001, endRadius * reach);
    const alpha =
      BEAM_ALPHA * smoothstep(0.03, 0.18, radius) * (1 - smoothstep(0.75, 1, forward));

    renderer.draw(radius, progress, elapsed / 1000, alpha);
    if (progress < 1) {
      frame = requestAnimationFrame(tick);
    } else {
      stop();
    }
  };

  renderer.draw(0.001, 0, 0, 0);
  document.documentElement.append(renderer.canvas);
  frame = requestAnimationFrame(tick);
  deadline = window.setTimeout(stop, BEAM_DEADLINE_MS);
  return donePromise;
}
