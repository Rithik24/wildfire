#!/usr/bin/env bash
# Rebuild every incident package from the open archives (≈15 min, ~2 GB of downloads).
set -euo pipefail
cd "$(dirname "$0")/.."
export WILDFIRE_RAW="${WILDFIRE_RAW:-data/raw}"
declare -A RES=([park-2024]=80 [pantanal-2024]=100 [palisades-2025]=40)
for id in park-2024 pantanal-2024 palisades-2025; do
  python -m pipeline.fetch_viirs "$id"
  python -m pipeline.build_incident "$id" --res "${RES[$id]}"   # first pass picks the bbox
  python -m pipeline.sentinel2 "$id"
  python -m pipeline.build_incident "$id" --res "${RES[$id]}"   # refine with the burn scar
  python -m pipeline.weather "$id"
done
python -m pipeline.make_index
