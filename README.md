# QSO Globe

A slowly turning 3D globe of every station you have worked. Pins glow in band colours, arcs rise from your home locator, and a stats strip shows contacts, DXCC entities, continents and best DX. It is built for QRZ.com bio pages and works on any web page.

It comes in two forms, drawn by the same code:

- **An animated GIF** (one seamless turn of the globe). It suits QRZ bios, which allow images but not scripts.
- **An interactive page** for your own site. You can drag to turn the globe, and hovering over or tapping a pin shows the callsign, band, mode and date. The page is about 150 KB with no external requests, and it works on phones.

Copyright 2026 Paul Friend (M7PRL). Open source under the Apache License 2.0; see `LICENSE` and `NOTICE`.

## Quick start

```bash
npm install
cp config.example.json config.json      # then set your callsign and locator
node scripts/sample-data.mjs            # or import your log, below
node scripts/build.mjs
node scripts/serve.mjs                  # preview at http://localhost:5178/
node scripts/render-gif.mjs             # writes out/qso-globe.gif and a still PNG
```

`render-gif.mjs` drives Google Chrome headless. Options: `--size 460x520 --frames 120 --delay 125 --colours 160 --colour band|mode`.

## Your contacts

- **ADIF file from any logger:** `node scripts/import.mjs --adif mylog.adi`
- **QRZ Logbook API:** put `QRZ_LOGBOOK_KEY=...` in a `.env` file (git ignores it), then run `node scripts/import.mjs --qrz`. QRZ only allows API access for logbooks with an XML subscription or higher.

Locations come from the grid square first, then lat/lon, then the centre of the DXCC country. Every location is cut to four characters, so no one's home is pinpointed. Only callsign, band, mode, date, 4-character locator, DXCC entity and continent are published. Names, addresses and QSL details are never published.

## Page options (URL parameters)

| Parameter | Effect |
| --- | --- |
| `data=URL` | Load contacts from another file, so one host can serve many stations |
| `colour=mode` | Colour pins by mode instead of band |
| `turn=30` | Seconds per turn (default 15) |

## On a QRZ.com bio

QRZ bios strip scripts. They only allow iframes from QRZ's approved list, and images must be uploaded to QRZ itself. So:

1. Upload `qso-globe.gif` to your QRZ image files, and copy the URL QRZ gives it.
2. Edit your bio, switch the editor to **Source** view, and paste:

```html
<p style="text-align:center">
  <a href="INTERACTIVE_PAGE_URL" target="_blank" rel="noopener">
    <img src="QRZ_IMAGE_URL" width="460" alt="Stations I have worked: tap for the interactive globe" style="max-width:100%;height:auto;border-radius:12px">
  </a>
</p>
```

   Use the short form `/hampages/yourcall/qso-globe.gif` (callsign in lower case) for `QRZ_IMAGE_URL`. QRZ puts its own address in front of whatever you give it, so a full `https://…` address ends up broken.
3. Save, then view the page; QRZ doesn't show it while you're editing. To update it, upload a new GIF with the same file name.
4. QRZ's file upload refused a 2.85 MB GIF but took 0.86 MB. Render with `--size 360x405 --frames 75 --delay 200 --colours 64` to stay under the limit.

If QRZ ever approves the page for iframes, this embeds the live globe directly:

```html
<iframe src="INTERACTIVE_PAGE_URL" width="100%" height="560" style="border:0;border-radius:12px" loading="lazy" title="Stations worked"></iframe>
```

## Automatic daily refresh (GitHub Pages)

`.github/workflows/refresh.yml` runs once a day. It fetches the log from QRZ, rebuilds the page and the GIF, and publishes both to GitHub Pages. To set it up:

1. Add the repository secret `QRZ_LOGBOOK_KEY`.
2. Set Pages to deploy from GitHub Actions.

The key stays on GitHub's build machine and never appears in the published site.
