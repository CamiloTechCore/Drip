import { useEffect, useRef } from "react";
import {
  createNeuralScene,
  FIGURE_COLORS,
  SCENE_HEIGHT,
  SCENE_WIDTH,
} from "./neural-scene";

const scene = createNeuralScene();

/** Anchored contours stay recognizable while small pulses move through the network. */
export function NeuralCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0,
      height = 0,
      frame = 0,
      lastDraw = 0;
    let visible = true;

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      const scale = Math.min(width / SCENE_WIDTH, height / SCENE_HEIGHT);
      if (!scale) return;
      const seconds = reducedMotion.matches ? 0 : time / 1000;
      const movement = reducedMotion.matches ? 0 : 0.8;
      const points = scene.nodes.map((node) => ({
        ...node,
        x: node.x + Math.sin(seconds * 0.55 + node.phase) * movement,
        y: node.y + Math.cos(seconds * 0.45 + node.phase) * movement,
      }));
      ctx.save();
      ctx.translate(
        (width - SCENE_WIDTH * scale) / 2,
        (height - SCENE_HEIGHT * scale) / 20,
      );
      ctx.scale(scale, scale);
      scene.centers.forEach(([x, y], i) => {
        const color = Object.values(FIGURE_COLORS)[i];
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 105);
        glow.addColorStop(0, `rgba(${color},0.055)`);
        glow.addColorStop(1, `rgba(${color},0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(x - 105, y - 105, 210, 210);
      });
      scene.bridges.forEach(([ai, bi], i) => {
        const a = points[ai],
          b = points[bi];
        const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        gradient.addColorStop(0, `rgba(${FIGURE_COLORS[a.figure]},0.24)`);
        gradient.addColorStop(1, `rgba(${FIGURE_COLORS[b.figure]},0.24)`);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 7]);
        ctx.stroke();
        ctx.setLineDash([]);
        const progress = reducedMotion.matches
          ? 0.5
          : (seconds * 0.11 + i * 0.33) % 1;
        ctx.beginPath();
        ctx.arc(
          a.x + (b.x - a.x) * progress,
          a.y + (b.y - a.y) * progress,
          2.7,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = `rgba(${FIGURE_COLORS[a.figure]},0.65)`;
        ctx.fill();
      });
      scene.edges.forEach(({ a, b, structural }) => {
        ctx.beginPath();
        ctx.moveTo(points[a].x, points[a].y);
        ctx.lineTo(points[b].x, points[b].y);
        ctx.strokeStyle = `rgba(${FIGURE_COLORS[points[a].figure]},${structural ? 0.5 : 0.17})`;
        ctx.lineWidth = structural ? 1.45 : 0.85;
        ctx.stroke();
      });
      points.forEach((point) => {
        const color = FIGURE_COLORS[point.figure];
        if (point.emphasis) {
          ctx.beginPath();
          ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${color},0.08)`;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(point.x, point.y, point.emphasis ? 2.9 : 1.95, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color},${point.emphasis ? 0.95 : 0.75})`;
        ctx.fill();
      });
      ctx.restore();
    };

    const animate = (time: number) => {
      if (time - lastDraw >= 1000 / 30) {
        draw(time);
        lastDraw = time;
      }
      frame = requestAnimationFrame(animate);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      draw(performance.now());
      if (!reducedMotion.matches && visible && !document.hidden)
        frame = requestAnimationFrame(animate);
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      // Resizing clears the bitmap: redraw even when animations are disabled.
      resume();
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      resume();
    });
    resizeObserver.observe(canvas);
    intersectionObserver.observe(canvas);
    reducedMotion.addEventListener("change", resume);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("resize", resize);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      reducedMotion.removeEventListener("change", resume);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="neural-scene">
      <canvas
        ref={canvasRef}
        className="neural-canvas"
        role="img"
        aria-label="Tres figuras conectadas por nodos: un cerebro, una moneda Bitcoin y una billetera"
      >
        Un cerebro, una moneda Bitcoin y una billetera conectados por una red de
        nodos.
      </canvas>
    </div>
  );
}
