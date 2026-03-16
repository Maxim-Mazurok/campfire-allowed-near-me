# Campfire Allowed Near Me

**Find the closest NSW state forest where a campfire is legal right now.**

🔗 **[campfire-allowed-near-me.pages.dev](https://campfire-allowed-near-me.pages.dev)**

I wanted to make a campfire on a weekend trip. Simple enough, right? Turns out NSW state forests have Solid Fuel Fire Bans (Forestry Corporation), Total Fire Bans (NSW RFS), and individual closure notices — and they all change independently. The Forestry Corporation website groups forests into vague "areas" that mean nothing if you don't already know NSW geography, and some areas span thousands of kilometres. I was juggling between the Forestry Corp site, RFS, and Google Maps just to figure out where the nearest legal campfire spot was.

So I built this app. It pulls all the data together into one map and just tells you: **here's the closest place you can legally light a campfire right now.**

## How It Works

The app scrapes official data from Forestry Corporation NSW, the NSW Rural Fire Service, and FCNSW closure notices twice a day. It combines fire ban status, closure notices, and forest facilities into a single interactive map. No account needed, no app to install — just open it in your browser.

## Using the App

### The basics

1. **Open the app** — it asks for your location (or defaults to Sydney).
2. **See your answer immediately** — the top panel shows the **closest forest where campfires are legal** and the **closest legal campfire with camping facilities**, with distance and a button to get driving directions via Google Maps.
3. **Browse the map** — red pins are forests that match your current filters, grey pins are the rest. Tap or click any pin to see details.
4. **Scroll the list** — every forest is listed with its fire ban status, closure badges, facilities, and distance from you.

### Info icons and tooltips

Look for the small **ℹ️ info icons** next to badges, filter labels, and status text — click or tap one to see a brief explanation. On desktop you can also hover over an info icon to preview the explanation. Facility icons in forest cards show a tooltip on hover or tap.

The UI is designed to be self-documenting — if you're not sure what something means, look for the info icon next to it.

### Moving your location

Drag your location pin on the map, or click/tap anywhere on it, to recalculate distances from a different starting point.

### Advanced filters

Tap **Show advanced filters** to narrow down forests by:

- **Fire ban status** — filter by Solid Fuel Fire Ban or Total Fire Ban state.
- **Closure status** — show only fully open forests, exclude fully closed ones, or find forests with active notices.
- **Closure tags** — filter by notice type: road/trail access, camping, events, or operations/safety.
- **Impact warnings** — find forests where notices affect camping availability or 2WD/4WD access.
- **Facilities** — tri-state toggles (must have / must not have / doesn't matter) for camping, toilets, water, picnic areas, walking tracks, and more.

### Settings

The gear icon opens settings for colour theme (light/dark/system) and toll road preferences for driving estimates.

The warning icon (when visible) shows data quality diagnostics — mostly useful for verifying data integrity rather than day-to-day use.

## Data Freshness

Forest data updates automatically twice a day (around 4–5 AM and 4–5 PM Sydney time). The header shows when the snapshot was last updated.

## Disclaimer

⚠️ **Not official — always verify before lighting a fire.** This app aggregates publicly available data, but conditions can change rapidly. Check with Forestry Corporation NSW and NSW RFS before heading out.

## How It's Built

This is an open-source TypeScript project — a data pipeline scrapes and geocodes all forests into a static JSON snapshot, which a Leaflet + Mantine SPA loads directly in the browser. No backend server required. Hosted on Cloudflare Pages for free.

Built almost entirely with AI: the initial version was created with **OpenAI Codex (GPT-5.3-Codex)**, then extensively refactored and polished with **Claude Opus 4.6** via GitHub Copilot agent mode in VS Code. This means extra care is recommended when verifying results — see the disclaimer above.

**Want to contribute or run it locally?** See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Data sourced from [Forestry Corporation of NSW](https://www.forestrycorporation.com.au/) and [NSW Rural Fire Service](https://www.rfs.nsw.gov.au/).
