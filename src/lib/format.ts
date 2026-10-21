import { locale, type Lang } from "../i18n";
import { useStore } from "../store";

const cache = new Map<string, Intl.DateTimeFormat>();
const nfCache = new Map<string, Intl.NumberFormat>();

function dtf(lang: Lang, tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = lang + tz + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale(lang), { timeZone: tz, ...opts });
    cache.set(key, f);
  }
  return f;
}

export interface Fmt {
  date: (t: number) => string;
  dateTime: (t: number) => string;
  time: (t: number) => string;
  dayShort: (t: number) => string;
  tzLabel: string;
  num: (v: number, digits?: number) => string;
  area: (ha: number) => string;
  areaUnit: string;
  areaVal: (ha: number) => number;
  areaSecondary: (ha: number) => string;
  speed: (kmh: number | null | undefined) => string;
  speedUnit: string;
  dist: (km: number) => string;
  temp: (c: number | null | undefined) => string;
  volume: (gal: number) => string;
  volumeUnit: string;
  alt: (m: number) => string;
}

export function makeFmt(lang: Lang, tzMode: "local" | "utc", incidentTz: string, units: "metric" | "imperial"): Fmt {
  const tz = tzMode === "utc" ? "UTC" : incidentTz;
  const loc = locale(lang);
  const nf = (d: number) => {
    const key = loc + d;
    let f = nfCache.get(key);
    if (!f) {
      f = new Intl.NumberFormat(loc, { maximumFractionDigits: d, minimumFractionDigits: 0 });
      nfCache.set(key, f);
    }
    return f;
  };
  const nf0 = nf(0);
  const imperial = units === "imperial";
  const tzLabel =
    tzMode === "utc"
      ? "UTC"
      : (dtf(lang, tz, { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? tz);
  return {
    date: (t) => dtf(lang, tz, { month: "short", day: "numeric", year: "numeric" }).format(t * 1000),
    dateTime: (t) => dtf(lang, tz, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t * 1000),
    time: (t) => dtf(lang, tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t * 1000),
    dayShort: (t) => dtf(lang, tz, { month: "short", day: "numeric" }).format(t * 1000),
    tzLabel,
    num: (v, d = 0) => nf(d).format(v),
    area: (ha) => (imperial ? `${nf0.format(ha / 0.404686)} ac` : ha >= 1e5 ? `${nf0.format(ha / 100)} km²` : `${nf0.format(ha)} ha`),
    areaUnit: imperial ? "acres" : "ha",
    areaVal: (ha) => (imperial ? ha / 0.404686 : ha),
    areaSecondary: (ha) => (imperial ? `${nf0.format(ha)} ha` : `${nf0.format(ha / 0.404686)} acres`),
    speed: (k) => (k == null ? "—" : imperial ? `${nf0.format(k / 1.609)} mph` : `${nf0.format(k)} km/h`),
    speedUnit: imperial ? "mph" : "km/h",
    dist: (km) => (imperial ? `${nf(1).format(km / 1.609)} mi` : `${nf(1).format(km)} km`),
    temp: (c) => (c == null ? "—" : imperial ? `${nf0.format(c * 1.8 + 32)} °F` : `${nf(1).format(c)} °C`),
    volume: (gal) => (imperial ? `${nf0.format(gal)} gal` : `${nf0.format(gal * 3.785)} L`),
    volumeUnit: imperial ? "gal" : "L",
    alt: (m) => (imperial ? `${nf0.format(m * 3.281)} ft` : `${nf0.format(m)} m`),
  };
}

export function useFmt(): Fmt {
  const lang = useStore((s) => s.lang);
  const tz = useStore((s) => s.tz);
  const units = useStore((s) => s.units);
  const itz = useStore((s) => s.bundle?.meta.timezone ?? "UTC");
  return makeFmt(lang, tz, itz, units);
}

export function compact(v: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang), { notation: "compact", maximumFractionDigits: 1 }).format(v);
}
