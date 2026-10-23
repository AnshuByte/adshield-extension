# AdShield — Popunder & Invisible Overlay Blocker

Stops redirect ads, popunders and transparent click-hijack layers that send you somewhere other than the link you clicked. Works on Chrome, Brave and Edge (Manifest V3, Chromium 111+).

## Features

- **Transparent click-layer neutralizer** — Detects and disarms rgba(0,0,0,0.01) overlays that steal your clicks
- **Popunder / tabunder blocker** — Patches `window.open` before page scripts run; blocks blank-window chains and background popups
- **Exit-confirm nag suppression** — Drops `beforeunload` traps that try to keep you on the page
- **Cosmetic ad hiding** — Removes sticky footers, offerwalls and injected ad slots
- **Network filter** — Blocks 80+ ad/tracker/redirect domains via Declarative Net Request (no request interception overhead)
- **Per-site allowlist** — Disable protection on specific sites without turning off the extension globally
- **Custom blocklist** — Add your own domains on top of the built-in lists
- **Export / Import / Reset** — Settings are synced via `chrome.storage.sync`

## Load the extension

1. Open `chrome://extensions` (or `brave://extensions` / `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked** → select this folder
4. The AdShield icon appears in the toolbar

## Development

### Rebuild DNR rulesets

```bash
npm run build
```

Reads the domain lists in `tools/build-rules.mjs` and writes `rules/redirects.json`, `rules/ads.json` and `rules/trackers.json`.

### Regenerate icons

```bash
npm run icons
```

Requires PowerShell with .NET (`System.Drawing`). Writes `icons/icon{16,32,48,128}.png`.

### Run the smoke-test suite

```bash
npm test
# or with a custom Chrome binary:
node tools/test-extension.mjs "C:\path\to\chrome.exe"
```

Launches headless Chrome with the extension loaded, serves `test/demo.html` and runs 13 assertions via the Chrome DevTools Protocol.

## File layout

```
manifest.json
icons/                  # Extension icons (all sizes)
rules/                  # Generated DNR rulesets (do not edit by hand)
src/
  background.js         # Service worker: rules, stats, badge, message bus
  ui.css                # Shared design tokens, switches, pills, cards
  content/
    main-guard.js       # MAIN world: window.open patch, click-hijack defense, exit-nag blocker
    overlay-guard.js    # ISOLATED world: MutationObserver, viewport probe, cosmetic hiding
    cosmetic.css        # CSS-side cosmetic rules (activated via data attribute)
  popup/
    popup.html/js/css   # Toolbar popup
  options/
    options.html/js/css # Full settings page
test/
  demo.html             # Reproduces 6 real-world attack patterns
  ok.html               # Target for same-site popup test
tools/
  build-rules.mjs       # Generates rules/*.json from curated domain lists
  make-icons.ps1        # Generates icons/*.png using .NET System.Drawing
  test-extension.mjs    # Headless CDP smoke-test harness
```

## Browser compatibility

| Browser | Supported |
|---------|-----------|
| Chrome 111+ | ✅ |
| Brave (latest) | ✅ |
| Edge 111+ | ✅ |
| Firefox | ❌ (MV3 DNR API differs) |
| Safari | ❌ |
