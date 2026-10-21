import { useId, useMemo, useState } from "react";
import { useStore } from "../store";
import { useFmt } from "../lib/format";
import { Chip, Dropdown, downloadCsv, useSize } from "./common";
import { Icon } from "./icons";
import type { Prov } from "../data/types";
import { useT } from "../i18n";

export interface Series {
  t: number[];
  v: number[];
}

export interface ChartProps {
  title: string;
  unit: string;
  prov: Prov;
  series: Series;
  kind?: "area" | "line" | "bars" | "step";
  color?: string;
  domain: [number, number];
  nights?: [number, number][];
  markers?: { t: number; v: number; label: string }[];
  fmt?: (v: number) => string;
  csvName: string;
  /** dashed continuation after the cursor (the "future" of the series) */
  dimFuture?: boolean;
}

const PAD = { l: 34, r: 8, t: 6, b: 18 };

export function TimeChart(p: ChartProps) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const fmtT = useFmt();
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId().replace(/:/g, "");
  const color = p.color ?? "var(--chart-line)";
  const fmt = p.fmt ?? ((v: number) => compactNum(v));

  const geo = useMemo(() => {
    if (!w || !h) return null;
    const [t0, t1] = p.domain;
    const iw = Math.max(10, w - PAD.l - PAD.r);
    const ih = Math.max(10, h - PAD.t - PAD.b);
    let max = 0;
    for (const v of p.series.v) if (v > max) max = v;
    for (const m of p.markers ?? []) if (m.v > max) max = m.v;
    max = niceMax(max || 1);
    const x = (tt: number) => PAD.l + ((tt - t0) / (t1 - t0)) * iw;
    const y = (v: number) => PAD.t + ih - (v / max) * ih;
    let line = "";
    const n = p.series.t.length;
    const kind = p.kind ?? "area";
    if (kind === "bars") {
      const bw = Math.max(1.2, Math.min(6, iw / Math.max(n, 1) * 0.8));
      for (let i = 0; i < n; i++) {
        const xx = x(p.series.t[i]);
        line += `M${(xx - bw / 2).toFixed(1)},${y(0).toFixed(1)}V${y(p.series.v[i]).toFixed(1)}h${bw.toFixed(1)}V${y(0).toFixed(1)}z`;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const xx = x(p.series.t[i]).toFixed(1);
        const yy = y(p.series.v[i]).toFixed(1);
        if (i === 0) line += `M${xx},${yy}`;
        else if (kind === "step") line += `H${xx}V${yy}`;
        else line += `L${xx},${yy}`;
      }
    }
    const area = kind === "area" || kind === "step" ? `${line}L${x(p.series.t[n - 1] ?? t1).toFixed(1)},${y(0)}L${x(p.series.t[0] ?? t0).toFixed(1)},${y(0)}Z` : "";
    // day ticks
    const ticks: { x: number; label: string }[] = [];
    const span = t1 - t0;
    const stepDays = span > 20 * 86400 ? 7 : span > 8 * 86400 ? 3 : 1;
    const first = Math.ceil(t0 / 86400) * 86400;
    if (span <= 2 * 86400) {
      for (let tt = Math.ceil(t0 / 10800) * 10800; tt <= t1; tt += 10800) ticks.push({ x: x(tt), label: fmtT.time(tt) });
    } else {
      for (let tt = first; tt <= t1; tt += 86400 * stepDays) ticks.push({ x: x(tt), label: fmtT.dayShort(tt) });
    }
    return { x, y, line, area, max, ticks, iw, ih };
  }, [w, h, p.series, p.domain, p.kind, p.markers, fmtT]);

  const valueAt = (tt: number) => {
    const s = p.series;
    let best = 0;
    for (let i = 0; i < s.t.length; i++) {
      if (s.t[i] <= tt) best = i;
      else break;
    }
    return s.v[best] ?? 0;
  };

  const onMove = (e: React.PointerEvent) => {
    if (!geo) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientX - r.left - PAD.l) / geo.iw;
    if (f < 0 || f > 1) return setHover(null);
    setHover(p.domain[0] + f * (p.domain[1] - p.domain[0]));
  };

  return (
    <div className="chart">
      <div className="chart-h">
        <b>{p.title}</b>
        <span className="u">({p.unit})</span>
        <Chip p={p.prov} />
        <Dropdown className="menu-btn" align="right" button={<Icon name="more" size={14} />}>
          {(close) => (
            <button
              className="mi"
              onClick={() => {
                downloadCsv(p.csvName, ["time_utc", `value_${p.unit.replace(/[^a-z0-9]+/gi, "_")}`], p.series.t.map((tt, i) => [new Date(tt * 1000).toISOString(), p.series.v[i]]));
                close();
              }}
            >
              <Icon name="download" size={14} /> {t("download_csv")}
            </button>
          )}
        </Dropdown>
      </div>
      <div
        className="chart-body"
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={() => hover != null && useStore.getState().setTime(hover)}
        style={{ cursor: "crosshair" }}
      >
        {geo && (
          <svg role="img" aria-label={`${p.title} chart`}>
            <defs>
              <clipPath id={clipId}>
                <rect x={PAD.l} y={PAD.t - 4} width={geo.iw} height={geo.ih + 8} />
              </clipPath>
            </defs>
            <g clipPath={`url(#${clipId})`}>
              {(p.nights ?? [])
                .filter(([a, b]) => b > p.domain[0] && a < p.domain[1])
                .map(([a, b], i) => (
                  <rect key={i} x={geo.x(a)} y={PAD.t} width={Math.max(0, geo.x(b) - geo.x(a))} height={geo.ih} fill="var(--night)" />
                ))}
            </g>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={PAD.l} x2={PAD.l + geo.iw} y1={geo.y(geo.max * f)} y2={geo.y(geo.max * f)} stroke="var(--line)" strokeDasharray={f ? "2 3" : undefined} />
                <text x={PAD.l - 5} y={geo.y(geo.max * f) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--muted)">
                  {compactNum(geo.max * f)}
                </text>
              </g>
            ))}
            {geo.ticks.map((tk, i) => (
              <text key={i} x={tk.x} y={PAD.t + geo.ih + 13} textAnchor="middle" fontSize="9.5" fill="var(--muted)">
                {tk.label}
              </text>
            ))}
            <g clipPath={`url(#${clipId})`}>
              {geo.area && <path d={geo.area} fill={p.color ? hexA(p.color, 0.16) : "var(--chart-fill)"} />}
              <path d={geo.line} fill={p.kind === "bars" ? color : "none"} stroke={p.kind === "bars" ? "none" : color} strokeWidth={1.6} strokeLinejoin="round" />
            </g>
            {(p.markers ?? []).map((m, i) => (
              <g key={i}>
                <circle cx={geo.x(m.t)} cy={geo.y(m.v)} r={4} fill="var(--card)" stroke="var(--chip-reported)" strokeWidth={2}>
                  <title>{m.label}</title>
                </circle>
              </g>
            ))}
            <Cursor x={geo.x} y={(tt) => geo.y(valueAt(tt))} top={PAD.t} bottom={PAD.t + geo.ih} domain={p.domain} dim={p.dimFuture ? PAD.l + geo.iw : null} />
            {hover != null && <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.t} y2={PAD.t + geo.ih} stroke="var(--muted)" strokeDasharray="2 2" />}
          </svg>
        )}
        {hover != null && geo && (
          <div className="chart-tip" style={{ left: geo.x(hover), top: geo.y(valueAt(hover)) }}>
            {fmtT.dateTime(hover)} · {fmt(valueAt(hover))}
          </div>
        )}
      </div>
    </div>
  );
}

function Cursor({ x, y, top, bottom, domain, dim }: { x: (t: number) => number; y: (t: number) => number; top: number; bottom: number; domain: [number, number]; dim: number | null }) {
  const time = useStore((s) => s.time);
  const tt = Math.min(domain[1], Math.max(domain[0], time));
  const cx = x(tt);
  return (
    <g pointerEvents="none">
      {dim != null && cx < dim && <rect x={cx} y={top} width={dim - cx} height={bottom - top} fill="var(--card)" opacity={0.55} />}
      <line x1={cx} x2={cx} y1={top} y2={bottom} stroke="var(--text)" strokeWidth={1.2} />
      <circle cx={cx} cy={y(tt)} r={3.6} fill="var(--accent)" stroke="var(--card)" strokeWidth={1.5} />
      <circle cx={cx} cy={bottom} r={3} fill="var(--card)" stroke="var(--text)" strokeWidth={1.2} />
    </g>
  );
}

function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function compactNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  if (a >= 10) return `${Math.round(v)}`;
  return `${+v.toFixed(1)}`;
}

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
