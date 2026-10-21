// Small stroke icon set (24×24 grid, 1.8 px stroke), drawn for this app.
import type { SVGProps } from "react";

const P: Record<string, string> = {
  flame: "M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.3 1.2-3.7 2.3-4.8.3 1.7 1.2 2.6 2.2 2.8-.6-2.8.1-5.6.5-8z",
  drone: "M9 10h6v4H9zM4 6l5 4M20 6l-5 4M4 18l5-4M20 18l-5-4M2 6h4M18 6h4M2 18h4M18 18h4",
  truck: "M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01",
  plane: "M21 15l-8-4V5a1.5 1.5 0 0 0-3 0v6l-8 4v2l8-2v4l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-4l8 2z",
  heli: "M3 5h16M11 5v3M6 12a5 4 0 0 0 10 0 5 4 0 0 0-10 0M16 12h6M21 10v4M8 16l-1 3M14 16l1 3M5 19h12",
  crew: "M8 7a3 3 0 1 0 6 0 3 3 0 0 0-6 0M4 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2M16 3.5a3 3 0 0 1 0 6",
  dozer: "M3 15h12V9H8l-2 3H3zM15 11h3l3 5M3 15v2h14M5 19a1.5 1.5 0 1 0 0-.01M13 19a1.5 1.5 0 1 0 0-.01M18 9v8",
  layers: "M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  chart: "M3 3v18h18M7 15l4-5 3 3 5-7",
  share: "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6M8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
  play: "M7 4v16l13-8z",
  pause: "M7 4h4v16H7zM14 4h4v16h-4z",
  prev: "M19 20 9 12l10-8zM5 4v16",
  next: "M5 4l10 8-10 8zM19 4v16",
  stepb: "M11 19 4 12l7-7M20 19l-7-7 7-7",
  stepf: "M13 5l7 7-7 7M4 5l7 7-7 7",
  chev: "M6 9l6 6 6-6",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M21 21l-5-5",
  download: "M12 3v12M7 10l5 5 5-5M4 20h16",
  more: "M12 6h.01M12 12h.01M12 18h.01",
  x: "M6 6l12 12M18 6 6 18",
  max: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  min: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 16v-4M12 8h.01",
  crosshair: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M22 12h-4M6 12H2M12 6V2M12 22v-4",
  wind: "M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8",
  thermo: "M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z",
  drop: "M12 2.7s-6 6.4-6 11.3a6 6 0 0 0 12 0c0-4.9-6-11.3-6-11.3z",
  gauge: "M12 14l4-4M3.3 19a10 10 0 1 1 17.4 0",
  sat: "M13 7 9 3 3 9l4 4M17 11l4 4-6 6-4-4M8 12l4 4M16.5 7.5l-9 9M18 2l4 4M14 6l4 4",
  pin: "M12 22s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",
  menu: "M3 6h18M3 12h18M3 18h18",
  camera: "M3 7h4l2-3h6l2 3h4v13H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  calendar: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4",
  route: "M6 19a2 2 0 1 0 0-.01M18 5a2 2 0 1 0 0-.01M6 17V9a4 4 0 0 1 4-4h6M18 7v8a4 4 0 0 1-4 4H8",
  target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  battery: "M3 7h15v10H3zM21 10v4M6 10v4M9 10v4",
  signal: "M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5",
  radio: "M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M12 12h.01",
  compare: "M12 3v18M5 7l-3 5 3 5M19 7l3 5-3 5",
  alert: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  trend: "M22 7l-8.5 8.5-5-5L2 17M16 7h6v6",
  moonstar: "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8zM17 3l.5 1.5L19 5l-1.5.5L17 7l-.5-1.5L15 5l1.5-.5z",
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  const filled = name === "play" || name === "pause" || name === "prev" || name === "next";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={P[name]} />
    </svg>
  );
}
