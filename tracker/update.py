#!/usr/bin/env python3
"""
Riftbound price tracker - daily update.

Downloads Cardmarket's public daily price guide + product catalog for
Riftbound (game id 22), stores a dated snapshot, and rebuilds:

  docs/data/latest.json   - every product with current price and % changes
  docs/data/history.json  - daily trend price per product (for charts)
  docs/data/meta.json     - run info, watchlist matches, warnings
  docs/riftbound_prices.xlsx - spreadsheet export
  alerts.md               - watchlist / big-mover alerts (empty if none)

Usage:
  python tracker/update.py                      # download from Cardmarket
  python tracker/update.py --price-guide f.json --singles s.json [--nonsingles n.json]
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.json"
WATCHLIST_PATH = ROOT / "watchlist.txt"
SNAP_DIR = ROOT / "data" / "snapshots"
CATALOG_PATH = ROOT / "data" / "products.json"
CARDINFO_PATH = ROOT / "data" / "cardinfo.json"
OPENRIFT = "https://openrift.app/api/v1"
IMAGE_BASE = "https://openrift.app/media/cards/"
RARITY_ORDER = ["Common", "Uncommon", "Rare", "Epic", "Showcase", "Promo"]
DOCS_DATA = ROOT / "docs" / "data"
XLSX_PATH = ROOT / "docs" / "riftbound_prices.xlsx"
ALERTS_PATH = ROOT / "alerts.md"
CARDS_PATH = DOCS_DATA / "cards.json"                    # binder catalog (all printings)
COLLECTION_PATH = ROOT / "data" / "collection.json"      # written by the dashboard (GitHub sync)
COLL_HIST_PATH = DOCS_DATA / "collection_history.json"   # daily collection value

BASE = "https://downloads.s3.cardmarket.com/productCatalog"

# Columns stored per snapshot. Keys are the field names in Cardmarket's file.
FIELDS = ["trend", "low", "avg", "avg1", "avg7", "avg30",
          "trend-foil", "low-foil", "avg-foil", "avg1-foil", "avg7-foil", "avg30-foil"]


# --------------------------------------------------------------------------- io
def load_json_any(path: Path):
    raw = path.read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8-sig"))


def user_agent():
    import os
    repo = os.environ.get("GITHUB_REPOSITORY")
    where = f"; https://github.com/{repo}" if repo else ""
    return f"riftbound-price-tracker/1.1 (personal daily price snapshot{where})"


def download_json(url: str, tries: int = 4):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": user_agent(),
                "Accept-Encoding": "gzip",
            })
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
            if raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8-sig"))
        except Exception as e:  # noqa: BLE001
            last = e
            wait = 5 * (attempt + 1)
            print(f"  download failed ({e}); retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"Could not download {url}: {last}")


def num(v):
    """Cardmarket uses null / 0 for 'no data'. Treat both as missing."""
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def pct(new, old):
    if new is None or old is None or old <= 0:
        return None
    return round((new - old) / old * 100, 1)


# ----------------------------------------------------------------------- config
DEFAULT_CONFIG = {
    "game_id": 22,
    "include_sealed": True,
    "history_days": 400,
    "movers_min_price": 1.0,
    "expansions": {},
    "watchlist_alerts": {"pct_1d": 15, "pct_7d": 25},
    "all_cards_alerts": {"enabled": True, "min_price": 5.0, "pct_1d": 40},
    "spreadsheet_history_days": 90,
}


def load_config():
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if CONFIG_PATH.exists():
        user = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        for k, v in user.items():
            if k.startswith("_"):
                continue
            if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                cfg[k].update(v)
            else:
                cfg[k] = v
    return cfg


# --------------------------------------------------------------------- fetching
def fetch(cfg, args):
    gid = cfg["game_id"]
    if args.price_guide:
        guide = load_json_any(Path(args.price_guide))
        singles = load_json_any(Path(args.singles)) if args.singles else {"products": []}
        nonsingles = load_json_any(Path(args.nonsingles)) if args.nonsingles else {"products": []}
    else:
        print("Downloading Cardmarket price guide ...")
        guide = download_json(f"{BASE}/priceGuide/price_guide_{gid}.json")
        print("Downloading product catalog ...")
        singles = download_json(f"{BASE}/productList/products_singles_{gid}.json")
        nonsingles = {"products": []}
        if cfg["include_sealed"]:
            try:
                nonsingles = download_json(f"{BASE}/productList/products_nonsingles_{gid}.json")
            except RuntimeError as e:
                print(f"  (sealed catalog skipped: {e})", file=sys.stderr)
    if not isinstance(guide, dict) or not isinstance(guide.get("priceGuides"), list):
        raise SystemExit("Price guide file has an unexpected format (no 'priceGuides' list).")
    return guide, singles, nonsingles


def guide_date(guide) -> str:
    created = str(guide.get("createdAt") or "")
    m = re.match(r"(\d{4}-\d{2}-\d{2})", created)
    return m.group(1) if m else dt.datetime.now(dt.timezone.utc).date().isoformat()


def update_catalog(singles, nonsingles):
    """Merge new catalog into data/products.json so names survive if a file is missing."""
    catalog = {}
    if CATALOG_PATH.exists():
        catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    for src, kind in ((singles, "single"), (nonsingles, "sealed")):
        for p in (src or {}).get("products", []) or []:
            pid = p.get("idProduct")
            if pid is None:
                continue
            catalog[str(pid)] = {
                "name": p.get("name") or p.get("enName") or f"Product {pid}",
                "category": p.get("categoryName") or "",
                "expansion": p.get("idExpansion"),
                "kind": kind,
                "added": (p.get("dateAdded") or "")[:10],
            }
    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_PATH.write_text(json.dumps(catalog, ensure_ascii=False, sort_keys=True, indent=0),
                            encoding="utf-8")
    return catalog


def build_cardinfo(catalog, links):
    """
    Map Cardmarket product ids to OpenRift printing info (image, set, rarity, number).
    Result: {"<idProduct>": {...normal...}, "<idProduct>f": {...foil...}}
    """
    sets = {s["id"]: s for s in catalog.get("sets", [])}
    cards = catalog.get("cards", {})
    printings = catalog.get("printings", {})
    out, by_pid = {}, {}
    for printing_id, link in (links.get("links") or {}).items():
        cm = (link or {}).get("cardmarket") or {}
        pid = cm.get("productId")
        pr = printings.get(printing_id)
        if not pid or pr is None:
            continue
        card = cards.get(pr.get("cardId"), {})
        st = sets.get(pr.get("setId"), {})
        imgs = pr.get("images") or []
        info = {
            "name": card.get("name"),
            "set": st.get("name"),
            "setCode": st.get("slug"),
            "rarity": pr.get("rarity"),
            "code": pr.get("publicCode") or pr.get("shortCode"),
            "rank": pr.get("canonicalRank"),
            "img": (imgs[0].get("imageId") if imgs else None) or pr.get("fallbackImageId"),
            "type": " ".join((card.get("superTypes") or []) + (card.get("types") or [])) or None,
            "domains": card.get("domains") or [],
            "slug": card.get("slug"),
            "art": pr.get("artVariant"),
            "signed": bool(pr.get("isSigned")),
        }
        key = f"{pid}f" if (pr.get("finish") or "").lower() == "foil" else str(pid)
        old = out.get(key)
        # Several printings can share one Cardmarket product: keep the first in catalog order.
        if old is None or (info["rank"] or 1e9) < (old["rank"] or 1e9):
            out[key] = info
        prev = by_pid.get(str(pid))
        if prev is None or (info["rank"] or 1e9) < (prev["rank"] or 1e9):
            by_pid[str(pid)] = info
    # Normal and foil of one product show the same card: fill the missing side.
    for pid, info in by_pid.items():
        out.setdefault(pid, info)
        out.setdefault(pid + "f", info)
    return out


def _title(s):
    return (s or "").title()


def card_display_name(card):
    """
    OpenRift names legends by their title only ("Pridestalker", "Dark Child, Starter"), while
    decklists and Cardmarket use "Rengar, Pridestalker" / "Annie, Dark Child". Same rule as
    OpenRift's own legendDisplayName(): champion tag + title.
    """
    name = card.get("name") or ""
    types = [t.lower() for t in card.get("types") or []]
    tags = card.get("tags") or []
    if "legend" not in types or not tags:
        return name
    prefix = f"{tags[0]}, "
    if name.startswith(prefix):
        return name
    title = name.split(", ")[0]
    return prefix + title


def build_binder(catalog, links):
    """
    Every English printing, grouped into binder slots by printed card number
    (normal + foil of the same card share a slot), with their Cardmarket product ids.
    """
    cards = catalog.get("cards", {})
    pid_of = {}
    for prid, link in (links.get("links") or {}).items():
        cm = (link or {}).get("cardmarket") or {}
        if cm.get("productId"):
            pid_of[prid] = cm["productId"]
    sets = {s["id"]: s for s in catalog.get("sets", [])}
    slots = {}
    for prid, pr in (catalog.get("printings") or {}).items():
        if (pr.get("language") or "EN") != "EN":
            continue
        card = cards.get(pr.get("cardId"), {})
        code = pr.get("publicCode") or pr.get("shortCode") or prid
        key = code
        s = slots.get(key)
        if s is not None and s["card"] != card.get("slug"):
            key = f"{code}|{card.get('slug')}"
            s = slots.get(key)
        imgs = pr.get("images") or []
        img = (imgs[0].get("imageId") if imgs else None) or pr.get("fallbackImageId")
        st = sets.get(pr.get("setId"), {})
        if s is None:
            s = slots[key] = {
                "k": key, "name": card_display_name(card) or pr.get("printedName") or code,
                "card": card.get("slug"), "set": st.get("slug") or "?",
                "rank": pr.get("canonicalRank") if pr.get("canonicalRank") is not None else 10**9,
                "rar": _title(pr.get("rarity")),
                "type": _title(" ".join((card.get("superTypes") or []) + (card.get("types") or []))),
                "dom": [_title(d) for d in card.get("domains") or []],
                "img": img, "fin": [], "cm": {},
            }
            if card.get("name") and card.get("name") != s["name"]:
                s["alt"] = card["name"]          # OpenRift's own name, also accepted in decklists
            if pr.get("isSigned"):
                s["sig"] = True
            if pr.get("artVariant") and pr["artVariant"] != "normal":
                s["art"] = pr["artVariant"]
        finish = "foil" if (pr.get("finish") or "").lower() == "foil" else "normal"
        if finish not in s["fin"]:
            s["fin"].append(finish)
        if prid in pid_of:
            s["cm"].setdefault(finish, pid_of[prid])
            # every Cardmarket product of this card number (reprints can have their own product)
            alls = s.setdefault("cmx", {}).setdefault(finish, [])
            if pid_of[prid] not in alls:
                alls.append(pid_of[prid])
        if pr.get("canonicalRank") is not None:
            s["rank"] = min(s["rank"], pr["canonicalRank"])
        if not s["img"] and img:
            s["img"] = img
    out = sorted(slots.values(), key=lambda s: (s["rank"], s["k"]))
    for s in out:
        s["fin"].sort(key=lambda f: f != "normal")
    first_rank = {}
    for s in out:
        first_rank.setdefault(s["set"], s["rank"])
    set_list = []
    for st in catalog.get("sets", []):
        if st.get("slug") in first_rank:
            set_list.append({"slug": st["slug"], "name": st.get("name"),
                             "released": ((st.get("releases") or {}).get("EN") or {}).get("releasedAt"),
                             "count": sum(1 for s in out if s["set"] == st["slug"])})
    set_list.sort(key=lambda x: first_rank[x["slug"]])
    return {"sets": set_list, "cards": out}


def update_cardinfo(args):
    """Download OpenRift card data. Keeps the last good copy if OpenRift is unavailable."""
    if args.cardinfo_catalog:
        catalog = load_json_any(Path(args.cardinfo_catalog))
        links = load_json_any(Path(args.cardinfo_links))
    else:
        try:
            print("Downloading card data from OpenRift ...")
            catalog = download_json(f"{OPENRIFT}/catalog?langs=EN", tries=2)
            links = download_json(f"{OPENRIFT}/prices/links", tries=2)
        except RuntimeError as e:
            return f"Card images/sets not refreshed today (OpenRift unavailable: {e}). Using the last saved copy."
    info = build_cardinfo(catalog, links)
    if len(info) < 50 and CARDINFO_PATH.exists():
        return f"OpenRift returned only {len(info)} linked cards - kept the last saved card data."
    binder = build_binder(catalog, links)
    DOCS_DATA.mkdir(parents=True, exist_ok=True)
    CARDS_PATH.write_text(json.dumps(binder, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Binder catalog: {len(binder['cards'])} cards in {len(binder['sets'])} sets")
    CARDINFO_PATH.write_text(json.dumps(info, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                             encoding="utf-8")
    print(f"Card data: {len(info)} Cardmarket products linked to card images")
    return None


def save_snapshot(guide, date: str):
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    path = SNAP_DIR / f"{date}.csv"
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["idProduct"] + FIELDS)
        for row in sorted(guide["priceGuides"], key=lambda r: r.get("idProduct") or 0):
            pid = row.get("idProduct")
            if pid is None:
                continue
            vals = [num(row.get(k)) for k in FIELDS]
            if all(v is None for v in vals):
                continue
            w.writerow([pid] + ["" if v is None else f"{v:g}" for v in vals])
    return path


# ------------------------------------------------------------------ snapshots
def read_snapshot(path: Path):
    """Return {key: {field: value}} where key is 'id' (normal) or 'idf' (foil)."""
    out = {}
    with path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            pid = r["idProduct"]
            g = {k: (float(r[k]) if r.get(k) else None) for k in FIELDS}
            # Only use Cardmarket's trend price. A product with just a "low" price has no
            # sales yet, and its cheapest listing can be a placeholder like 100,000 EUR.
            if g["trend"] is not None:
                out[pid] = {"trend": g["trend"], "low": g["low"], "avg1": g["avg1"],
                            "avg7": g["avg7"], "avg30": g["avg30"]}
            if g["trend-foil"] is not None:
                out[pid + "f"] = {"trend": g["trend-foil"], "low": g["low-foil"],
                                  "avg1": g["avg1-foil"], "avg7": g["avg7-foil"],
                                  "avg30": g["avg30-foil"]}
    return out


def load_history(max_days: int):
    files = sorted(SNAP_DIR.glob("????-??-??.csv"))[-max_days:]
    return [(p.stem, read_snapshot(p)) for p in files]


def value_on_or_before(history, idx_today, target_date, key):
    """Trend price for key on the latest snapshot dated <= target_date."""
    for i in range(idx_today - 1, -1, -1):
        d, snap = history[i]
        if d <= target_date:
            v = snap.get(key)
            return v["trend"] if v else None
    return None


# --------------------------------------------------------------- watchlist
def parse_watchlist(catalog):
    entries, warnings = [], []
    if not WATCHLIST_PATH.exists():
        return set(), warnings, entries
    by_name = {}
    for pid, p in catalog.items():
        by_name.setdefault(p["name"].lower(), []).append(pid)
    keys = set()
    for line in WATCHLIST_PATH.read_text(encoding="utf-8").splitlines():
        raw = line.split("#", 1)[0].strip()
        if not raw:
            continue
        foil_only = normal_only = False
        text = raw
        if text.lower().endswith("(foil)"):
            foil_only, text = True, text[:-6].strip()
        elif text.lower().endswith("(normal)"):
            normal_only, text = True, text[:-8].strip()
        m = re.search(r"idProduct=(\d+)", text) or re.fullmatch(r"(\d+)", text)
        if m:
            ids = [m.group(1)]
        elif text.lower() in by_name:
            ids = by_name[text.lower()]
        else:
            ids = [pid for name, pids in by_name.items() if text.lower() in name for pid in pids]
        if not ids:
            warnings.append(f"Watchlist: no card matched '{raw}'")
            continue
        if len(ids) > 15:
            warnings.append(f"Watchlist: '{raw}' matched {len(ids)} products - only the first 15 kept; be more specific")
            ids = ids[:15]
        for pid in ids:
            if not foil_only:
                keys.add(pid)
            if not normal_only:
                keys.add(pid + "f")
        entries.append({"line": raw, "matches": len(ids)})
    return keys, warnings, entries


# --------------------------------------------------------------------- build
def build(cfg, extra_warnings=()):
    history = load_history(cfg["history_days"])
    if not history:
        raise SystemExit("No snapshots yet.")
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8")) if CATALOG_PATH.exists() else {}
    cardinfo = json.loads(CARDINFO_PATH.read_text(encoding="utf-8")) if CARDINFO_PATH.exists() else {}
    watch_keys, warnings, watch_entries = parse_watchlist(catalog)
    warnings = list(extra_warnings) + warnings
    # Set names: OpenRift tells us which set each linked card is in, so learn
    # Cardmarket expansion id -> set name from those, then apply it to every product.
    learned = {}
    for pid, p in catalog.items():
        ci = cardinfo.get(pid)
        if ci and ci.get("set") and p.get("expansion") is not None:
            learned.setdefault(str(p["expansion"]), (ci["set"], ci.get("setCode")))
    exp_names = {k: v[0] for k, v in learned.items()}
    exp_codes = {k: v[1] for k, v in learned.items()}
    exp_names.update({str(k): v for k, v in cfg.get("expansions", {}).items()})
    # Which finishes really exist per Cardmarket product (from OpenRift). Rares, epics and most
    # showcases are foil-only: Cardmarket's "normal" numbers for them come from a few mislabelled
    # listings and don't match the price shown on Cardmarket's own card page.
    finishes = {}
    if CARDS_PATH.exists():
        try:
            for s in json.loads(CARDS_PATH.read_text(encoding="utf-8"))["cards"]:
                for fin, cm_pid in (s.get("cm") or {}).items():
                    finishes.setdefault(str(cm_pid), set()).add(fin)
                for fin, pids in (s.get("cmx") or {}).items():
                    for cm_pid in pids:
                        finishes.setdefault(str(cm_pid), set()).add(fin)
        except (ValueError, KeyError):
            finishes = {}
    skipped = 0

    today_idx = len(history) - 1
    today, snap = history[today_idx]
    tdate = dt.date.fromisoformat(today)
    prev_date = history[today_idx - 1][0] if today_idx > 0 else None
    d7 = (tdate - dt.timedelta(days=7)).isoformat()
    d30 = (tdate - dt.timedelta(days=30)).isoformat()

    items = []
    for key, v in snap.items():
        pid = key.rstrip("f")
        foil = key.endswith("f")
        p = catalog.get(pid, {})
        if not cfg["include_sealed"] and p.get("kind") == "sealed":
            continue
        if pid in finishes and ("foil" if foil else "normal") not in finishes[pid]:
            skipped += 1
            continue
        prev = history[today_idx - 1][1].get(key) if today_idx > 0 else None
        exp = p.get("expansion")
        ci = cardinfo.get(key) or cardinfo.get(pid) or {}
        items.append({
            "k": key,
            "id": int(pid),
            "name": p.get("name", f"Product {pid}"),
            "foil": foil,
            "cat": p.get("category", ""),
            "kind": p.get("kind", "single"),
            "set": ci.get("set") or exp_names.get(str(exp), f"Set {exp}" if exp else ""),
            "sc": ci.get("setCode") or exp_codes.get(str(exp)) or "",
            # OpenRift uses lowercase slugs ("showcase", "champion unit"): capitalise for display.
            "rar": (ci.get("rarity") or "").title() or ("Sealed" if p.get("kind") == "sealed" else ""),
            "code": ci.get("code") or "",
            "rank": ci.get("rank"),
            "img": ci.get("img"),
            "type": (ci.get("type") or "").title() or ("Sealed" if p.get("kind") == "sealed" else ""),
            "dom": [d.title() for d in (ci.get("domains") or [])],
            "slug": ci.get("slug"),
            "sig": ci.get("signed") or None,
            "price": v["trend"],
            "low": v["low"],
            "avg7": v["avg7"],
            "avg30": v["avg30"],
            "ch1": pct(v["trend"], prev["trend"] if prev else None),
            "ch7": pct(v["trend"], value_on_or_before(history, today_idx, d7, key)),
            "ch30": pct(v["trend"], value_on_or_before(history, today_idx, d30, key)),
            # Cardmarket's own signal, useful before we have our own history:
            "vs30": pct(v["trend"], v["avg30"]),
            "watch": key in watch_keys,
        })
    items.sort(key=lambda x: -(x["price"] or 0))

    # history.json: compact arrays, only for products present today
    dates = [d for d, _ in history]
    series = {}
    for it in items:
        k = it["k"]
        series[k] = [(s.get(k) or {}).get("trend") for _, s in history]

    DOCS_DATA.mkdir(parents=True, exist_ok=True)
    (DOCS_DATA / "latest.json").write_text(json.dumps({"date": today, "items": items},
                                                      ensure_ascii=False, separators=(",", ":")),
                                           encoding="utf-8")
    (DOCS_DATA / "history.json").write_text(json.dumps({"dates": dates, "series": series},
                                                       separators=(",", ":")), encoding="utf-8")

    record_collection_value(items, today)
    alerts = make_alerts(cfg, items, today, prev_date)
    meta = {
        "date": today,
        "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
        "days_of_history": len(history),
        "products": len(items),
        "watchlist": watch_entries,
        "warnings": warnings,
        "alerts": len(alerts),
        "movers_min_price": cfg["movers_min_price"],
        "image_base": cfg.get("image_base") or IMAGE_BASE,
        "rarity_order": RARITY_ORDER,
        "with_images": sum(1 for i in items if i["img"]),
    }
    (DOCS_DATA / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    write_alerts(alerts, today, warnings)
    write_xlsx(cfg, items, history)
    if skipped:
        print(f"Left out {skipped} finish(es) that don't exist for that card (e.g. normal versions of foil-only rares)")
    print(f"{today}: {len(items)} products, {len(history)} day(s) of history, "
          f"{sum(i['watch'] for i in items)} watchlist entries, {len(alerts)} alert(s)")
    for w in warnings:
        print("WARNING:", w)


def record_collection_value(items, today):
    """Add today's collection value (from the synced collection.json) to collection_history.json."""
    if not (COLLECTION_PATH.exists() and CARDS_PATH.exists()):
        return
    try:
        coll = json.loads(COLLECTION_PATH.read_text(encoding="utf-8"))
        slots = {s["k"]: s for s in json.loads(CARDS_PATH.read_text(encoding="utf-8"))["cards"]}
    except (ValueError, KeyError) as e:
        print(f"Collection value skipped: {e}", file=sys.stderr)
        return
    price = {it["k"]: it["price"] for it in items}
    value, copies = 0.0, 0
    for key, q in (coll.get("cards") or {}).items():
        s = slots.get(key)
        if not s:
            continue
        n, f = int(q.get("n") or 0), int(q.get("f") or 0)
        copies += n + f
        cm = s.get("cm") or {}
        if n and cm.get("normal"):
            value += n * (price.get(str(cm["normal"])) or 0)
        if f:
            pid = cm.get("foil") or cm.get("normal")
            if pid:
                value += f * (price.get(f"{pid}f") or price.get(str(pid)) or 0)
    hist = {"dates": [], "value": [], "copies": []}
    if COLL_HIST_PATH.exists():
        hist = json.loads(COLL_HIST_PATH.read_text(encoding="utf-8"))
    if today in hist["dates"]:
        i = hist["dates"].index(today)
        hist["value"][i], hist["copies"][i] = round(value, 2), copies
    else:
        hist["dates"].append(today); hist["value"].append(round(value, 2)); hist["copies"].append(copies)
    COLL_HIST_PATH.write_text(json.dumps(hist, separators=(",", ":")), encoding="utf-8")
    print(f"Collection: {copies} cards worth {value:.2f} EUR")


def label(it):
    return f"{it['name']}{' (foil)' if it['foil'] else ''}"


def make_alerts(cfg, items, today, prev_date):
    wa, aa = cfg["watchlist_alerts"], cfg["all_cards_alerts"]
    out = []
    for it in items:
        reasons = []
        if it["watch"]:
            if it["ch1"] is not None and abs(it["ch1"]) >= wa["pct_1d"]:
                reasons.append(f"{it['ch1']:+.1f}% since {prev_date}")
            if it["ch7"] is not None and abs(it["ch7"]) >= wa["pct_7d"]:
                reasons.append(f"{it['ch7']:+.1f}% over 7 days")
        elif aa.get("enabled") and (it["price"] or 0) >= aa["min_price"] \
                and it["ch1"] is not None and abs(it["ch1"]) >= aa["pct_1d"]:
            reasons.append(f"{it['ch1']:+.1f}% since {prev_date}")
        if reasons:
            out.append((it, reasons))
    out.sort(key=lambda x: (not x[0]["watch"], -abs(x[0]["ch1"] or x[0]["ch7"] or 0)))
    return out


def write_alerts(alerts, today, warnings):
    if not alerts:
        ALERTS_PATH.write_text("", encoding="utf-8")
        return
    lines = [f"Riftbound price alerts for **{today}** (Cardmarket trend price)\n",
             "| | Card | Price | Change | Link |", "|---|---|---|---|---|"]
    for it, reasons in alerts:
        arrow = "📈" if (it["ch1"] or it["ch7"] or 0) > 0 else "📉"
        star = "⭐ " if it["watch"] else ""
        url = f"https://www.cardmarket.com/en/Riftbound/Products?idProduct={it['id']}"
        lines.append(f"| {arrow} | {star}{label(it)} | €{it['price']:.2f} | {'; '.join(reasons)} | [Cardmarket]({url}) |")
    lines.append("\n⭐ = on your watchlist. Thresholds are set in `config.json`.")
    if warnings:
        lines += ["", "**Warnings**", *[f"- {w}" for w in warnings]]
    ALERTS_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ------------------------------------------------------------------- xlsx
def write_xlsx(cfg, items, history):
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        from openpyxl.formatting.rule import CellIsRule
        from openpyxl.utils import get_column_letter
    except ImportError:
        print("openpyxl not installed - skipping spreadsheet", file=sys.stderr)
        return

    wb = Workbook()
    head_font = Font(bold=True, color="FFFFFF")
    head_fill = PatternFill("solid", fgColor="1F2937")
    green = PatternFill("solid", fgColor="D1FAE5")
    red = PatternFill("solid", fgColor="FEE2E2")
    eur, pctf = '€#,##0.00', '+0.0"%";-0.0"%";0.0"%"'

    cols = [("Card", 38, None), ("Foil", 6, None), ("Set", 14, None), ("Number", 13, None),
            ("Rarity", 11, None), ("Type", 18, None),
            ("Watch", 7, None), ("Price (trend)", 13, eur), ("Lowest", 10, eur),
            ("1 day %", 9, pctf), ("7 days %", 9, pctf), ("30 days %", 10, pctf),
            ("vs CM 30d avg %", 15, pctf), ("Cardmarket link", 16, None)]

    def sheet(ws, rows):
        ws.append([c[0] for c in cols])
        for c in ws[1]:
            c.font, c.fill = head_font, head_fill
            c.alignment = Alignment(vertical="center")
        for it in rows:
            ws.append([it["name"], "yes" if it["foil"] else "", it["set"], it["code"], it["rar"],
                       it["type"] or it["cat"],
                       "⭐" if it["watch"] else "", it["price"], it["low"],
                       it["ch1"], it["ch7"], it["ch30"], it["vs30"], "open"])
            r = ws.max_row
            link = ws.cell(r, len(cols))
            link.hyperlink = f"https://www.cardmarket.com/en/Riftbound/Products?idProduct={it['id']}"
            link.font = Font(color="2563EB", underline="single")
        for i, (_, w, fmt) in enumerate(cols, 1):
            L = get_column_letter(i)
            ws.column_dimensions[L].width = w
            if fmt:
                for c in ws[L][1:]:
                    c.number_format = fmt
        last = ws.max_row
        if last > 1:
            rng = f"J2:M{last}"
            ws.conditional_formatting.add(rng, CellIsRule(operator="greaterThan", formula=["0"], fill=green))
            ws.conditional_formatting.add(rng, CellIsRule(operator="lessThan", formula=["0"], fill=red))
        ws.freeze_panes = "B2"
        ws.auto_filter.ref = ws.dimensions

    minp = cfg["movers_min_price"]
    movers = [i for i in items if (i["price"] or 0) >= minp and (i["ch7"] if i["ch7"] is not None else i["vs30"]) is not None]
    movers.sort(key=lambda i: -abs(i["ch7"] if i["ch7"] is not None else i["vs30"]))

    ws = wb.active
    ws.title = "Biggest movers"
    sheet(ws, movers[:200])
    sheet(wb.create_sheet("Watchlist"), [i for i in items if i["watch"]])
    sheet(wb.create_sheet("All prices"), items)

    # History: one row per product, one column per day (trend price)
    ws = wb.create_sheet("Price history")
    hist = history[-cfg["spreadsheet_history_days"]:]
    ws.append(["Card", "Foil"] + [d for d, _ in hist])
    for c in ws[1]:
        c.font, c.fill = head_font, head_fill
    for it in items:
        ws.append([it["name"], "yes" if it["foil"] else ""] +
                  [(s.get(it["k"]) or {}).get("trend") for _, s in hist])
    ws.column_dimensions["A"].width = 38
    for i in range(3, len(hist) + 3):
        L = get_column_letter(i)
        ws.column_dimensions[L].width = 11
        for c in ws[L][1:]:
            c.number_format = eur
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = ws.dimensions

    XLSX_PATH.parent.mkdir(parents=True, exist_ok=True)
    wb.save(XLSX_PATH)


# --------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--price-guide", help="use a local price_guide_22.json instead of downloading")
    ap.add_argument("--singles", help="local products_singles_22.json")
    ap.add_argument("--nonsingles", help="local products_nonsingles_22.json")
    ap.add_argument("--cardinfo-catalog", help="local OpenRift /catalog JSON (testing)")
    ap.add_argument("--cardinfo-links", help="local OpenRift /prices/links JSON (testing)")
    ap.add_argument("--rebuild-only", action="store_true", help="skip download, just rebuild outputs")
    args = ap.parse_args()

    cfg = load_config()
    warnings = []
    if not args.rebuild_only:
        guide, singles, nonsingles = fetch(cfg, args)
        date = guide_date(guide)
        update_catalog(singles, nonsingles)
        path = save_snapshot(guide, date)
        print(f"Saved snapshot {path.relative_to(ROOT)} ({len(guide['priceGuides'])} rows)")
        if cfg.get("card_images", True) and (args.cardinfo_catalog or not args.price_guide):
            w = update_cardinfo(args)
            if w:
                warnings.append(w)
    build(cfg, warnings)


if __name__ == "__main__":
    main()
