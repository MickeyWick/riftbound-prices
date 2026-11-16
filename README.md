# Riftbound Price Tracker

Tracks the Cardmarket price of every Riftbound card (singles and sealed product) once a day.
It shows which cards spike or drop, follows your own watchlist, and opens a GitHub issue
(which GitHub emails to you) when a card you watch moves a lot.

**Where the data comes from:** Cardmarket's own public, free, daily price-guide download for
Riftbound (`price_guide_22.json`) plus the product catalog for card names. This is the same
file you can download from Cardmarket's *Price Guide* page. Nothing is scraped, and no
Cardmarket account or API key is needed. The script makes one download per day.

**Card pictures, sets and rarity** come from [OpenRift](https://openrift.app)'s free, open Riftbound
API. It links every card printing to its Cardmarket product number. The tracker downloads that
list once a day and the dashboard shows the card art straight from OpenRift. Unofficial fan
project; card art and text © Riot Games.

**What you get**
- A dashboard website (free GitHub Pages) with three views:
  - **Cards + prices**: the full card picture with price trend, lowest listing, 30-day average,
    1/7/30-day changes and a mini price chart next to it.
  - **Grid**: a gallery of cards with price and change under each one.
  - **Table**: a compact list with every number.
  - Sort by price, biggest rise or drop, set & card number, rarity or name. Group by set,
    rarity, card type or domain, filter by set, rarity, foil/normal and singles/sealed, or search.
    Click any card for a big picture and its full price chart. Your choices are remembered.
- Biggest spikes and drops, your watchlist, and a price chart for each card.
- `riftbound_prices.xlsx`, rebuilt every day, with sheets for biggest movers, your watchlist,
  all prices and daily price history. Download it from the dashboard.
- Alerts: a GitHub issue titled "Price alerts YYYY-MM-DD" on days a card crosses your thresholds.

---

## Setup (about 10 minutes, one time)

1. **Create a GitHub account** at <https://github.com> if you don't have one.
2. **Create a new repository**: click **+ → New repository**, name it e.g. `riftbound-prices`,
   choose **Public**, and click **Create repository**.
   *(The free dashboard site needs a public repo. With a paid GitHub plan, private works too.)*
3. **Upload the files**: on the new repo page click **uploading an existing file**, then drag
   in *everything inside* this folder, including the hidden `.github` folder. On macOS, press
   `Cmd+Shift+.` in Finder to see it. Then click **Commit changes**.
   - If the `.github` folder didn't upload, create the file by hand: **Add file → Create new file**,
     name it `.github/workflows/daily.yml`, and paste the contents of that file.
4. **Allow the bot to save data**: go to **Settings → Actions → General → Workflow permissions**,
   select **Read and write permissions**, and click **Save**.
5. **Run it the first time**: go to the **Actions** tab. If it asks, click
   **I understand my workflows, go ahead and enable them**. Then choose **Daily price update →
   Run workflow → Run workflow**. Wait about a minute until it has a green tick.
6. **Turn on the dashboard**: go to **Settings → Pages**. Under *Build and deployment* choose
   **Deploy from a branch**, branch **main**, folder **/docs**, and click **Save**.
   After a minute or two your dashboard is live at
   `https://<your-username>.github.io/riftbound-prices/`.

From then on it runs by itself every morning, even when your computer is off.

## Your watchlist

Open `watchlist.txt` in the repo on GitHub, click the ✏️ pencil, add one card per line, and
click **Commit changes**. The dashboard updates a minute later. You can write a card name,
part of a name, a Cardmarket product link, or a product id. Add `(foil)` or `(normal)` to
watch only one version. Lines that match nothing are listed as warnings on the dashboard.

## My collection (binder and decklists)

The **📚 My collection** tab on the dashboard has three parts:

- **Binder:** every card in every set, in card-number order, 9 cards per page like a real
  binder (two pages side by side on a computer). Use **+ / −** to set how many normal and foil
  copies you own. Cards you don't own are greyed out. Search finds a card across all sets, and
  you can show only owned or only missing cards. Arrow keys flip pages.
- **My cards:** everything you own, with value and **where it is**, e.g.
  *Kai'Sa, Survivor: 3× Rengar, Pridestalker · 2× Draven, Glorious Executioner*, plus how many
  copies are spare or how many you're short for your decks.
- **Decklists:** import decks by pasting a text list. On Piltover Archive: open the deck →
  **Export** → **Export as Text**. Lists from other sites work too, one card per line like
  `3 Kai'Sa, Survivor`. Each deck shows its Cardmarket price (cheapest version of each card),
  how many cards you own, and what the missing ones would cost.

**Where it's saved:** in your browser. Use **⬇ Backup** now and then. To use the same
collection on your PC and phone, click **☁ Sync across devices** and follow the steps there:
it uses a GitHub key that only has access to this repo, and saves to `data/collection.json`.
With sync on, the daily update also charts your collection's value over time.

## Getting alerts by email

Alerts are GitHub issues. GitHub emails you about new issues in your own repos by default.
To check, open **Watch** (top of the repo) and make sure it is set to **All Activity**, and
check that email notifications are on under <https://github.com/settings/notifications>.
The GitHub mobile app can send phone notifications for issues too.

## Settings (`config.json`)

| Setting | Default | Meaning |
|---|---|---|
| `movers_min_price` | 1.0 | Hide cards under €1 from the movers lists (cheap cards swing wildly). |
| `watchlist_alerts.pct_1d` / `pct_7d` | 15 / 25 | Alert when a watched card moves this % in 1 day / 7 days. |
| `all_cards_alerts` | €5+, 40% in a day | Also alert on big one-day spikes for any card. Set `"enabled": false` to turn off. |
| `include_sealed` | true | Also track booster boxes, packs and other sealed products. |
| `card_images` | true | Download card pictures, set, rarity and card number from OpenRift. |
| `expansions` | {} | Only needed for products OpenRift doesn't know: name a Cardmarket set id, e.g. `"6286": "Origins"`. |

## How the numbers work

- **Price** is Cardmarket's *trend* price, its smoothed estimate of what the card sells for.
  Foil and normal versions are tracked separately.
- **1 day / 7 days / 30 days** compare today's trend price with the tracker's own saved
  snapshots. They fill in as history builds up: after 2 days, 8 days and 31 days.
- **vs CM 30d** compares today's trend price with Cardmarket's own 30-day average sale price.
  It works from day one and is the best spike signal until the tracker has a week of history.
- Daily snapshots are kept in `data/snapshots/` as small CSV files, so the full history is
  yours and opens in Excel.

## Run it on your own computer (optional)

```bash
pip install -r requirements.txt
python tracker/update.py
# then open docs/index.html via a local server:
python -m http.server -d docs 8000   # → http://localhost:8000
```

## Notes

- GitHub pauses scheduled workflows in a repo that has had no activity for 60 days. If the
  dashboard stops updating, open the Actions tab and re-enable the workflow.
- If OpenRift is down on a given day, prices still update and the last saved card pictures and
  set info are reused. New cards OpenRift hasn't linked yet show their name instead of a picture.
- Prices are Cardmarket's published price-guide values (EUR), not live listings. Check the
  card page before buying or selling.
