#!/usr/bin/env python3
"""Fetch CC0/CC-BY low-poly vignette models from poly.pizza (server-rendered,
scrapeable). Prefers Quaternius (CC0). Writes public/models/<id>.glb and
public/models/credits.json for on-page attribution.
"""

import json
import os
import re
import sys
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "models")
os.makedirs(OUT, exist_ok=True)

UA = {"User-Agent": "Mozilla/5.0 (peoples-of-africa asset fetch; CC0/CC-BY only)"}

WANTED = [
    ("giraffe", "giraffe"),
    ("elephant", "elephant"),
    ("lion", "lion"),
    ("gorilla", "gorilla"),
    ("camel", "camel"),
    ("zebra", "zebra"),
    ("rhino", "rhinoceros"),
    ("sailboat", "sailboat"),
    ("palm", "palm tree"),
]

import time

def _fetch(url, binary=False):
    for attempt in range(6):
        try:
            r = urlopen(Request(url, headers=UA), timeout=60).read()
            time.sleep(1.2)  # stay under the rate limit
            return r if binary else r.decode("utf-8", "ignore")
        except Exception as e:
            wait = 8 * (attempt + 1)
            print(f"  retry {url.split('/')[-1]} in {wait}s ({e})", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"gave up: {url}")

def get(url):
    return _fetch(url)

def get_bin(url):
    return _fetch(url, binary=True)

def model_info(mid):
    html = get(f"https://poly.pizza/m/{mid}")
    glb = re.search(r"https://static\.poly\.pizza/([0-9a-f-]+)\.glb", html)
    title = re.search(r"<title[^>]*>([^<|]+)", html)
    # author appears as /u/<Name> links
    author = re.search(r'/u/([^"/]+)"', html)
    lic = "CC0" if ("CC0" in html or "Public Domain" in html) else (
        "CC-BY" if "Creative Commons Attribution" in html else "unknown")
    tris = re.search(r"([\d,]+)\s*triangles", html)
    return {
        "id": mid,
        "glb": glb.group(0) if glb else None,
        "title": (title.group(1).strip() if title else mid),
        "author": (author.group(1).replace("%20", " ") if author else "unknown"),
        "license": lic,
        "tris": int(tris.group(1).replace(",", "")) if tris else None,
    }

credits = {}
for name, query in WANTED:
    dest = os.path.join(OUT, f"{name}.glb")
    if os.path.exists(dest):
        print(f"{name}: cached")
        continue
    html = get(f"https://poly.pizza/search/{query.replace(' ', '%20')}")
    ids = list(dict.fromkeys(re.findall(r"/m/([A-Za-z0-9]+)", html)))[:5]
    infos = []
    for mid in ids:
        try:
            info = model_info(mid)
        except Exception as e:
            print(f"  {mid}: {e}", file=sys.stderr)
            continue
        if info["glb"]:
            infos.append(info)
    if not infos:
        print(f"{name}: NOTHING FOUND", file=sys.stderr)
        continue
    # The title must actually name the thing — "lion" once returned a
    # clownfish. Then prefer Quaternius, CC0, small.
    word = query.split()[0].lower()
    import re as _re
    whole = lambda t: bool(_re.search(rf"\b{word}\b", t.lower()))
    infos.sort(key=lambda i: (
        0 if whole(i["title"]) else 2,
        0 if i["author"].lower() == "quaternius" else 1,
        0 if i["license"] == "CC0" else 1,
        i["tris"] or 10**9,
    ))
    if not whole(infos[0]["title"]):
        print(f"{name}: no title match, skipping ({infos[0]['title']!r})", file=sys.stderr)
        continue
    best = infos[0]
    data = get_bin(best["glb"])
    with open(dest, "wb") as f:
        f.write(data)
    credits[name] = {k: best[k] for k in ("title", "author", "license", "id")}
    credits[name]["bytes"] = len(data)
    print(f"{name}: {best['title']!r} by {best['author']} ({best['license']}, "
          f"{best['tris']} tris, {len(data)//1024} kB)")

cpath = os.path.join(OUT, "credits.json")
existing = json.load(open(cpath)) if os.path.exists(cpath) else {}
existing.update(credits)
json.dump(existing, open(cpath, "w"), indent=1)
print("credits.json written")
