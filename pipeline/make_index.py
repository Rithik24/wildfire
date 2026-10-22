"""Write public/data/index.json, the incident catalogue the app opens with.

Live incidents (built by pipeline/live.py) come first, most significant first;
the curated archive follows, newest first.
"""

import json
import os


def main(out="public/data"):
    live, archive = [], []
    for d in sorted(os.listdir(out)):
        p = os.path.join(out, d, "incident.json")
        if not os.path.exists(p):
            continue
        m = json.load(open(p))
        item = {
            "id": m["id"], "name": m["name"], "region": m["region"], "country": m["country"],
            "start": m["t0"], "end": m["end"], "center": m["center"], "area_ha": m["stats"]["area_ha"],
            "detections": m["stats"]["detections"], "reported_acres": m.get("reported", {}).get("final_acres"),
            "thumb": f"{d}/thumb.jpg" if os.path.exists(os.path.join(out, d, "thumb.jpg")) else None,
        }
        if m.get("live"):
            item["live"] = m["live"]
            live.append(item)
        else:
            archive.append(item)
    live.sort(key=lambda i: -i["live"].get("rank", 0))
    archive.sort(key=lambda i: i["start"], reverse=True)
    world = os.path.join(out, "live", "world.json")
    idx = {
        "incidents": live + archive,
        "world": "live/world.json" if os.path.exists(world) else None,
        "updated": json.load(open(world))["updated"] if os.path.exists(world) else None,
    }
    with open(os.path.join(out, "index.json"), "w") as f:
        json.dump(idx, f, indent=1)
    print(f"{len(live)} live + {len(archive)} archived incidents")


if __name__ == "__main__":
    main()
