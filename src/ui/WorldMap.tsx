import { useEffect, useMemo, useRef, useState } from "react";
import type { IncidentIndexItem, WorldFires } from "../data/types";
import { loadLand, loadWorld } from "../data/load";
import { useSize } from "./common";

const LAT_TOP = 78;
const LAT_BOT = -58;

let landCache: Promise<{ rings: [number, number][][] }> | null = null;

/**
 * Every VIIRS fire pixel on Earth in the last 48 h (binned), plus the incidents Emberline has
 * replays for. Equirectangular, drawn on a canvas; markers are buttons for keyboard users.
 */
export function WorldMap({
  worldPath,
  incidents,
  current,
  onPick,
}: {
  worldPath: string | null;
  incidents: IncidentIndexItem[];
  current: string | null;
  onPick: (id: string) => void;
}) {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const cv = useRef<HTMLCanvasElement>(null);
  const [world, setWorld] = useState<WorldFires | null>(null);
  const [land, setLand] = useState<{ rings: [number, number][][] } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const h = Math.round(w * ((LAT_TOP - LAT_BOT) / 360));

  useEffect(() => {
    landCache ??= loadLand();
    landCache.then(setLand).catch(() => setLand({ rings: [] }));
    if (worldPath) loadWorld(worldPath).then(setWorld).catch(() => setWorld(null));
  }, [worldPath]);

  const proj = useMemo(() => (lon: number, lat: number): [number, number] => [((lon + 180) / 360) * w, ((LAT_TOP - lat) / (LAT_TOP - LAT_BOT)) * h], [w, h]);

  useEffect(() => {
    const c = cv.current;
    if (!c || !w || !land) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue("--bg").trim() || "#f3eee5";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = css.getPropertyValue("--line-2").trim() || "#d6ccba";
    for (const ring of land.rings) {
      ctx.beginPath();
      ring.forEach(([lo, la], i) => {
        const [x, y] = proj(lo, la);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.fill();
    }
    if (world) {
      ctx.globalCompositeOperation = "source-over";
      for (const [lo, la, n, frp] of world.bins) {
        const [x, y] = proj(lo, la);
        const r = Math.min(7, 0.7 + Math.log10(1 + n) * 1.4);
        const hot = Math.min(1, Math.log10(1 + frp) / 4);
        ctx.fillStyle = `rgba(${230 + 25 * hot},${120 - 70 * hot},${30},${0.35 + 0.4 * hot})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [w, h, land, world, proj]);

  return (
    <div className="world" ref={ref}>
      <canvas ref={cv} style={{ width: "100%", height: h }} aria-label="Active fires worldwide in the last 48 hours" role="img" />
      {w > 0 &&
        incidents.map((i) => {
          const [x, y] = proj(i.center[0], i.center[1]);
          return (
            <button
              key={i.id}
              className={`wm-pin ${i.live ? "live" : ""} ${i.id === current ? "cur" : ""}`}
              style={{ left: x, top: y }}
              onClick={() => onPick(i.id)}
              onMouseEnter={() => setHover(i.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i.id)}
              onBlur={() => setHover(null)}
              aria-label={`${i.name}, ${i.region}`}
            >
              {hover === i.id && <span className="wm-tip">{i.name}</span>}
            </button>
          );
        })}
      {world && (
        <div className="wm-legend">
          <span className="wm-dot" /> {world.pixels_48h.toLocaleString()} VIIRS fire pixels in the last 48 h · updated {world.updated.replace("T", " ")} UTC
          <span className="wm-pin live static" /> burning now <span className="wm-pin static" /> archive
        </div>
      )}
    </div>
  );
}
