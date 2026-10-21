import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Prov } from "../data/types";
import { useT } from "../i18n";

export function Chip({ p, title }: { p: Prov; title?: string }) {
  const t = useT();
  const label = { real: t("p_real"), derived: t("p_derived"), reported: t("p_reported"), external: t("p_external"), sim: t("p_sim") }[p];
  const tips: Record<Prov, string> = {
    real: "Measured directly by a satellite or station",
    derived: "Computed by Emberline from real measurements (see Methods)",
    reported: "Published by an agency or the press (source linked)",
    external: "Third-party dataset used as is",
    sim: "Simulated: a rehearsal, not a record of what happened",
  };
  return (
    <span className={`chip ${p}`} title={title ?? tips[p]}>
      {label}
    </span>
  );
}

/** Closes when clicking outside or pressing Escape. */
export function Dropdown({ button, children, align = "left", className = "tb-btn" }: { button: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className={className} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {button}
      </button>
      {open && (
        <div className={`menu ${align === "right" ? "right" : ""}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function downloadCsv(name: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}
