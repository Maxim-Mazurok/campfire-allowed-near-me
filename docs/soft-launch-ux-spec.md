# Soft-Launch UX Specification

Tracks all UX changes requested for the soft-launch iteration.

## Tasks

### 1. Pin movement: no map reload
- **Status**: Not started
- Moving the location pin should NOT reload the whole map/query.
- It should only update the user location state and re-calculate routes.
- Root cause: `userLocation` changes trigger `forestsQueryKey` change → re-fetch.
- Fix: Separate location from query key when location source is MAP_PIN (pin drag).

### 2. Location panel text + layout
- **Status**: Not started
- Default (Sydney): "Showing for Sydney. Use my location or click/long-tap on map."
- Geolocation: "Using your current location."
- Map pin: "Using location from map pin."
- Location button on the LEFT, inline with the status text.

### 3. Camping preset: closures to "open"
- **Status**: Not started
- The Legal Campfire + Camping preset should set closures to "OPEN" (safe side).
- Should NOT set `impactCampingFilterMode` at all (leave as ANY).

### 4. Camping open filter: only available under "Partly closed"
- **Status**: Already implemented
- The camping open filter is already conditional on `closureStatusFilterMode === "PARTIAL"`.

### 5. Capitalize facility labels
- **Status**: Not started
- "mountain bike track" → "Mountain Bike Track"
- "horse riding" → "Horse Riding"
- Needs capitalization in `shortenFacilityLabel` or in the rendering.

### 6. Tooltips on all filters
- **Status**: Not started
- Add explanatory tooltips to every filter section: solid fuel ban, total fire ban, closures, closure tags, closure impact filters (2WD, 4WD, camping), facilities.
- Each tooltip should explain what the filter means for first-time users.

### 7. Move presets to map panel; left panel = advanced only
- **Status**: Not started
- Presets and "Show advanced filters" button go under the map meta text ("Showing X matching...").
- Inline, flexbox wrap.
- Left panel (FilterPanel) should ONLY contain advanced filters, no presets.
- On PC the left panel should be **hidden by default**.
- Clicking "Show advanced filters" opens the left panel.

### 8. Tooltip viewport fix on mobile
- **Status**: Not started
- Preset tooltips go outside viewport on mobile — not good.
- Fix: Use Mantine Tooltip `position="bottom"` on mobile, or constrain with `withinPortal`.

### 9. Location panel: no custom color
- **Status**: Not started
- Remove the blue border/background customization from `.location-panel`.
- Keep default panel color, adaptive by device theme and settings.

### 10. Driving button: green → primary (blue)
- **Status**: Not started
- Change the car/drive navigation link hover color from green to the primary theme color (blue).

### 11. Show both nearest spots (campfire + campfire+camping)
- **Status**: Already implemented in LocationStatusPanels
- Shows "Closest legal campfire" and "Closest legal campfire + camping".
- If same forest, shows single combined label.

### 12. Footer: heart icon + GitHub link
- **Status**: Not started
- Replace "love" text with a red heart icon (❤️ or Tabler icon).
- Add link to the GitHub repo: https://github.com/Maxim-Mazurok/campfire-allowed-near-me

### 13. Badge tooltips with explanations + badge layout
- **Status**: Not started
- Badge tooltips must explain what "solid fuel" means, that it's one source, etc.
- Hovering "CAMPFIRE: ALLOWED" shouldn't just say "No ban" — explain context.
- Badge layout change:
  - Row 1: forest name ... badge1 (solid fuel)
  - Row 2: forest area ... badge2 (total fire ban)
  - Row 3 (optional): ... badge3+ (closure, etc.)
- Badge text must never truncate (already done via CSS).

### 14. Run all tests and verify
- **Status**: Not started
- `npm test` must pass (typecheck + unit + integration + e2e).
