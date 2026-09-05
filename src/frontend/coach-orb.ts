/**
 * Coach orb: a living presence for the chess coach.
 *
 * A breathing core ringed by 64 orbiting chess squares. Four attention
 * states drive it: idle (slow breath), watching (amber pulse when the coach
 * notices something), speaking (squares ripple in sync with spoken words via
 * speech-synthesis boundary events), excited (fast swirl + flare on tactics).
 * Clicks are handled by the host (talk / repeat).
 *
 * No dependencies, canvas 2D, device-pixel aware, pauses offscreen.
 */

export type OrbState = "idle" | "watching" | "speaking" | "excited";

export interface CoachOrb {
  setState(state: OrbState): void;
  /** Nudge the ripple, e.g. from SpeechSynthesisUtterance onboundary. */
  beat(strength?: number): void;
  flare(): void;
  destroy(): void;
}

const SQUARES = 64;

export function createOrb(canvas: HTMLCanvasElement): CoachOrb {
  const ctx = canvas.getContext("2d");
  let state: OrbState = "idle";
  let ripple = 0;
  let flareEnergy = 0;
  let angle = 0;
  let running = true;
  let raf = 0;
  let last = performance.now();

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = 76;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  function colors(): { core: string; ring: string; glow: string } {
    switch (state) {
      case "watching":
        return { core: "#fbbf24", ring: "#f59e0b", glow: "rgba(251,191,36,0.35)" };
      case "speaking":
        return { core: "#7dd3fc", ring: "#38bdf8", glow: "rgba(56,189,248,0.30)" };
      case "excited":
        return { core: "#4ade80", ring: "#22c55e", glow: "rgba(74,222,128,0.45)" };
      default:
        return { core: "#4ade80", ring: "#166534", glow: "rgba(74,222,128,0.18)" };
    }
  }

  function frame(now: number) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!ctx) return;

    const speed = state === "excited" ? 2.6 : state === "speaking" ? 1.4 : 0.5;
    angle += dt * speed;
    ripple = Math.max(0, ripple - dt * 2.2);
    flareEnergy = Math.max(0, flareEnergy - dt * 1.4);

    const { core, ring, glow } = colors();
    const c = size / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // Breath.
    const breath = 1 + 0.045 * Math.sin(now / 900) + ripple * 0.09 + flareEnergy * 0.12;

    // Glow.
    const glowR = 15 * breath + flareEnergy * 8;
    const grad = ctx.createRadialGradient(c, c, 2, c, c, glowR + 12);
    grad.addColorStop(0, glow);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c, c, glowR + 12, 0, Math.PI * 2);
    ctx.fill();

    // Orbiting chess squares.
    for (let i = 0; i < SQUARES; i++) {
      const t = angle + (i / SQUARES) * Math.PI * 2;
      const wave = Math.sin(t * 3 + ripple * 9) * (1.5 + ripple * 4);
      const r = 24 * breath + wave;
      const x = c + Math.cos(t) * r;
      const y = c + Math.sin(t) * r;
      const light = (i + Math.floor(angle * 4)) % 2 === 0;
      ctx.fillStyle = light ? "rgba(229,231,235,0.85)" : ring;
      ctx.globalAlpha = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2 - angle * 3)) + flareEnergy * 0.25;
      const s = 2.1;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // Core pawn-node: circle head + body, currentColor of the moment.
    ctx.strokeStyle = core;
    ctx.fillStyle = core;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(c, c - 9, 4.6 * breath, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c - 7, c + 11);
    ctx.quadraticCurveTo(c - 5, c + 1, c, c + 1);
    ctx.quadraticCurveTo(c + 5, c + 1, c + 7, c + 11);
    ctx.closePath();
    ctx.stroke();
    ctx.fillRect(c - 9, c + 11, 18, 2.6);

    raf = requestAnimationFrame(frame);
  }

  raf = requestAnimationFrame(frame);

  return {
    setState(next: OrbState) {
      state = next;
      if (next === "excited") flareEnergy = Math.min(1, flareEnergy + 0.7);
    },
    beat(strength = 1) {
      ripple = Math.min(1.4, ripple + 0.35 * strength);
    },
    flare() {
      flareEnergy = 1;
    },
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
