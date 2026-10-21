"""Write public/data/index.json, the incident catalogue the app opens with."""

import json
import os

ORDER = ["park-2024", "pantanal-2024", "palisades-2025"]


def main(out="public/data"):
    items = []
    ids = [d for d in ORDER if os.path.exists(os.path.join(out, d, "incident.json"))]
    ids += sorted(d for d in os.listdir(out) if d not in ids and os.path.exists(os.path.join(out, d, "incident.json")))
    for d in ids:
        m = json.load(open(os.path.join(out, d, "incident.json")))
        items.append({
            "id": m["id"], "name": m["name"], "region": m["region"], "country": m["country"],
            "start": m["t0"], "end": m["end"], "center": m["center"], "area_ha": m["stats"]["area_ha"],
            "detections": m["stats"]["detections"], "reported_acres": m.get("reported", {}).get("final_acres"),
            "thumb": f"{d}/thumb.jpg" if os.path.exists(os.path.join(out, d, "thumb.jpg")) else None,
        })
    with open(os.path.join(out, "index.json"), "w") as f:
        json.dump({"incidents": items}, f, indent=1)
    print(f"{len(items)} incidents")


if __name__ == "__main__":
    main()
