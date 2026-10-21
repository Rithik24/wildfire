import type { IncidentBundle } from "../data/types";
import { DroneSim } from "./drones";
import { OpsSim } from "./ops";

const cache = new WeakMap<IncidentBundle, { drones: DroneSim; ops: OpsSim }>();

/** One simulation instance per incident, shared by the map and the panels. */
export function getSims(b: IncidentBundle, D: typeof DroneSim = DroneSim, O: typeof OpsSim = OpsSim) {
  let s = cache.get(b);
  if (!s) {
    s = { drones: new D(b), ops: new O(b) };
    cache.set(b, s);
  }
  return s;
}
