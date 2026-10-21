import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, timeRange } from "../store";
import { useFmt } from "../lib/format";
import { useT } from "../i18n";
import { Icon } from "./icons";
import { nightIntervals } from "../lib/sun";
import { passesWithFire } from "../data/analytics";
import { eventColor, eventsForMode } from "./events";

export const SPEEDS = [0.5, 1, 3, 6, 12, 24];

export function Timeline() {
  const b = useStore((s) => s.bundle)!;
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const mode = useStore((s) => s.mode);
  const lang = useStore((s) => s.lang);
  const fmt = useFmt();
  const t = useT();
  const [t0, t1] = timeRange(b);
  const trackRef = useRef<HTMLDivElement>(null);
  const events = useMemo(() => eventsForMode(b, mode, lang), [b, mode, lang]);

  const nights = useMemo(() => nightIntervals(t0, t1, b.meta.center[0], b.meta.center[1]), [b, t0, t1]);
  const hist = useMemo(() => {
    // detections per 3 h bin, for the density strip
    const bins = new Array(Math.ceil((t1 - t0) / 10800)).fill(0);
    for (const m of b.detections.t) {
      const k = Math.floor((b.meta.t0_epoch + m * 60 - t0) / 10800);
      if (k >= 0 && k < bins.length) bins[k]++;
    }
    const max = Math.max(1, ...bins);
    return bins.map((v) => v / max);
  }, [b, t0, t1]);
  const passes = useMemo(() => passesWithFire(b), [b]);

  const f = (tt: number) => ((tt - t0) / (t1 - t0)) * 100;
  const days = useMemo(() => {
    const out: number[] = [];
    // local midnights
    const off = b.meta.utc_offset_h * 3600;
    let d = Math.ceil((t0 + off) / 86400) * 86400 - off;
    for (; d <= t1; d += 86400) out.push(d);
    return out;
  }, [b, t0, t1]);
  const [trackW, setTrackW] = useState(800);
  useEffect(() => {
    if (!trackRef.current) return;
    const ro = new ResizeObserver(([e]) => setTrackW(e.contentRect.width));
    ro.observe(trackRef.current);
    return () => ro.disconnect();
  }, []);
  // ~46 px per day label
  const labelEvery = Math.max(1, Math.ceil((days.length * 46) / Math.max(trackW, 1)));

  const seek = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    useStore.getState().setTime(t0 + k * (t1 - t0));
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    seek(e.clientX);
    const move = (ev: PointerEvent) => seek(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const jumpEvent = (dir: 1 | -1) => {
    const list = dir > 0 ? events.filter((e) => e.t > time + 60) : events.filter((e) => e.t < time - 60).reverse();
    const ev = list[0];
    if (ev) {
      useStore.getState().setTime(ev.t);
      useStore.getState().set({ selectedEvent: ev.t });
    }
  };
  const jumpPass = (dir: 1 | -1) => {
    const list = dir > 0 ? passes.filter((p) => p.t > time + 60) : passes.filter((p) => p.t < time - 60).reverse();
    if (list[0]) useStore.getState().setTime(list[0].t);
  };

  const togglePlay = () => {
    const s = useStore.getState();
    if (!s.playing && s.time >= t1 - 60) s.setTime(t0);
    s.set({ playing: !s.playing });
  };

  return (
    <div className="timeline">
      <div className="tl-head">
        <b>{t("timeline")}</b>
        <span>
          {fmt.tzLabel} · VIIRS 375 m · {passes.length} passes with fire
        </span>
        <span className="range">
          {fmt.date(t0)} – {fmt.date(t1)}
        </span>
      </div>
      <div className="tl-ctrl">
        <button className="icon-btn" title={`${t("prev_event")} ([)`} onClick={() => jumpEvent(-1)} aria-label={t("prev_event")}>
          <Icon name="prev" size={13} />
        </button>
        <button className={`icon-btn play`} title={`${playing ? t("pause") : t("play")} (Space)`} onClick={togglePlay} aria-label={playing ? t("pause") : t("play")}>
          <Icon name={playing ? "pause" : "play"} size={13} />
        </button>
        <button className="icon-btn" title={`${t("next_event")} (])`} onClick={() => jumpEvent(1)} aria-label={t("next_event")}>
          <Icon name="next" size={13} />
        </button>
        <button className="icon-btn" title={`${t("prev_pass")} (,)`} onClick={() => jumpPass(-1)} aria-label={t("prev_pass")}>
          <Icon name="stepb" size={14} />
        </button>
        <button className="icon-btn" title={`${t("next_pass")} (.)`} onClick={() => jumpPass(1)} aria-label={t("next_pass")}>
          <Icon name="stepf" size={14} />
        </button>
        <select className="speed" value={speed} aria-label={t("speed")} onChange={(e) => useStore.getState().set({ speed: Number(e.target.value) })}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s < 1 ? `${s * 60} min/s` : `${s} h/s`}
            </option>
          ))}
        </select>
      </div>
      <div
        className="track"
        ref={trackRef}
        onPointerDown={onDown}
        role="slider"
        tabIndex={0}
        aria-label={t("timeline")}
        aria-valuemin={t0}
        aria-valuemax={t1}
        aria-valuenow={Math.round(time)}
        aria-valuetext={fmt.dateTime(time)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") useStore.getState().setTime(time + (e.shiftKey ? 86400 : 3600));
          if (e.key === "ArrowLeft") useStore.getState().setTime(time - (e.shiftKey ? 86400 : 3600));
        }}
      >
        <svg width="100%" height="100%">
          {nights.map(([a, z], i) => (
            <rect key={i} x={`${f(a)}%`} y={14} width={`${Math.max(0, f(z) - f(a))}%`} height={36} fill="var(--night)" />
          ))}
          {hist.map((v, i) =>
            v > 0 ? (
              <rect key={i} x={`${(i / hist.length) * 100}%`} y={50 - 9 * v} width={`${100 / hist.length}%`} height={9 * v} fill="var(--accent)" opacity={0.28} />
            ) : null,
          )}
          <line x1="0" x2="100%" y1={23} y2={23} stroke="var(--line-2)" strokeWidth={3} strokeLinecap="round" />
          <line x1="0" x2={`${f(time)}%`} y1={23} y2={23} stroke="var(--accent)" strokeWidth={3} strokeLinecap="round" />
          {passes.map((p, i) => (
            <line key={i} x1={`${f(p.t)}%`} x2={`${f(p.t)}%`} y1={27} y2={31} stroke="var(--muted)" strokeWidth={1} opacity={0.6} />
          ))}
          {days.map((d, i) => (
            <g key={d}>
              <line x1={`${f(d)}%`} x2={`${f(d)}%`} y1={18} y2={28} stroke="var(--line-2)" />
              {i % labelEvery === 0 && (
                <text x={`${f(d)}%`} y={45} fontSize="10.5" fill="var(--text-2)" textAnchor="middle">
                  {fmt.dayShort(d + 3600)}
                </text>
              )}
            </g>
          ))}
          {events.map((e, i) => (
            <circle key={i} cx={`${f(e.t)}%`} cy={23} r={e.major ? 4.2 : 3} fill={eventColor(e.kind)} stroke="var(--card)" strokeWidth={1.4}>
              <title>{e.title}</title>
            </circle>
          ))}
          <g>
            <line x1={`${f(time)}%`} x2={`${f(time)}%`} y1={14} y2={34} stroke="var(--text)" strokeWidth={1.5} />
            <circle cx={`${f(time)}%`} cy={23} r={6.5} fill="var(--card)" stroke="var(--text)" strokeWidth={2} />
            <circle cx={`${f(time)}%`} cy={23} r={2.5} fill="var(--text)" />
          </g>
        </svg>
        <div className="playhead-tag" style={{ left: `${f(time)}%` }}>
          {fmt.dateTime(time)}
        </div>
      </div>
      <div className="tl-legend">
        <span>
          <svg width="10" height="10">
            <rect width="10" height="10" fill="var(--night)" stroke="var(--line-2)" />
          </svg>{" "}
          night
        </span>
      </div>
    </div>
  );
}
