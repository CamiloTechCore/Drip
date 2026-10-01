import { useEffect, useRef } from "react";

type Cluster = 0 | 1 | 2;
interface Particle { x: number; y: number; vx: number; vy: number; r: number; cluster: Cluster; homeX: number; homeY: number; maxR: number }
interface ClusterDef { x: number; y: number; r: number; count: number; color: string }

// Posiciones relativas (0-1) de cada figura: cerebro, moneda y billetera.
const CLUSTERS: ClusterDef[] = [
  { x: 0.24, y: 0.3, r: 0.2, count: 22, color: "85,81,232" },
  { x: 0.78, y: 0.24, r: 0.15, count: 14, color: "19,132,101" },
  { x: 0.52, y: 0.8, r: 0.19, count: 20, color: "85,81,232" },
];
const BRIDGE_COLOR = "154,147,240";
const LINK_DISTANCE = 46;

function createParticles(width: number, height: number): Particle[] {
  const particles: Particle[] = [];
  CLUSTERS.forEach((cluster, index) => {
    const cx = cluster.x * width;
    const cy = cluster.y * height;
    const maxR = cluster.r * Math.min(width, height);
    for (let i = 0; i < cluster.count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * maxR;
      particles.push({
        x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius,
        vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
        r: Math.random() * 1.6 + 1.6, cluster: index as Cluster, homeX: cx, homeY: cy, maxR,
      });
    }
  });
  return particles;
}

/** Closest node pair between each pair of figures, so they always read as one connected network. */
function findBridges(particles: Particle[]): [Particle, Particle][] {
  const pairs: [Cluster, Cluster][] = [[0, 1], [1, 2], [2, 0]];
  return pairs.map(([a, b]) => {
    const groupA = particles.filter(p => p.cluster === a);
    const groupB = particles.filter(p => p.cluster === b);
    let best: [Particle, Particle] = [groupA[0], groupB[0]];
    let bestDist = Infinity;
    groupA.forEach(pa => groupB.forEach(pb => {
      const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      if (dist < bestDist) { bestDist = dist; best = [pa, pb]; }
    }));
    return best;
  });
}

/** Animated dot network: a brain, a coin and a wallet drifting and firing synapses. */
export function NeuralCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let bridges: [Particle, Particle][] = [];
    let frame = 0;
    let animationFrameId = 0;

    const setup = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      width = canvas.width = Math.round(rect?.width || canvas.clientWidth || 320);
      height = canvas.height = Math.round(rect?.height || canvas.clientHeight || 220);
      particles = createParticles(width, height);
      bridges = findBridges(particles);
    };

    const step = () => {
      frame += 1;
      ctx.clearRect(0, 0, width, height);
      if (!reduced) {
        particles.forEach(p => {
          p.x += p.vx; p.y += p.vy;
          const dx = p.x - p.homeX;
          const dy = p.y - p.homeY;
          if (Math.hypot(dx, dy) > p.maxR) { p.vx -= dx * 0.0025; p.vy -= dy * 0.0025; }
          p.vx *= 0.99; p.vy *= 0.99;
        });
      }
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          if (a.cluster !== b.cluster) continue;
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist < LINK_DISTANCE) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(${CLUSTERS[a.cluster].color}, ${0.5 * (1 - dist / LINK_DISTANCE)})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
      bridges.forEach(([a, b], i) => {
        const pulse = reduced ? 0.4 : 0.25 + 0.3 * Math.sin(frame / 40 + i * 2);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(${BRIDGE_COLOR}, ${pulse})`;
        ctx.setLineDash([2, 5]);
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.setLineDash([]);
      });
      particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${CLUSTERS[p.cluster].color}, 0.85)`;
        ctx.fill();
      });
      if (!reduced) animationFrameId = requestAnimationFrame(step);
    };

    setup();
    step();
    const resizeObserver = new ResizeObserver(() => setup());
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);

    return () => { cancelAnimationFrame(animationFrameId); resizeObserver.disconnect(); };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="neural-canvas"
      role="img"
      aria-label="Red de nodos animada que conecta un cerebro, una moneda y una billetera"
    />
  );
}
