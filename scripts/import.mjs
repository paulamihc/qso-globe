// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Paul Friend
// Turns a log into site/contacts.json for the globe.
//
//   node scripts/import.mjs --adif mylog.adi     read an ADIF file exported from any logger
//   node scripts/import.mjs --qrz                fetch the whole log from the QRZ Logbook API
//
// The QRZ route needs QRZ_LOGBOOK_KEY in the environment or in a .env file next to package.json
// (a QRZ XML subscription or higher is required by QRZ). The key is only ever sent to logbook.qrz.com.
//
// Only callsign, band, mode, date, 4-character locator, DXCC number and continent are written out.
// Locations come from GRIDSQUARE, then LAT/LON, then the centre of the DXCC country.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { geoCentroid } from 'd3-geo';
import { feature } from 'topojson-client';
import { gridToLatLon, latLonToGrid4 } from '../src/geo.js';

const here = (p) => new URL(`../${p}`, import.meta.url);
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] ?? true : undefined;
};
const config = JSON.parse(await readFile(here('config.json'), 'utf8'));

// ---- ADIF -----------------------------------------------------------------------------
export function parseAdif(text) {
  const eoh = text.search(/<eoh>/i);
  const body = eoh >= 0 ? text.slice(eoh + 5) : text;
  const records = [];
  let rec = {};
  const re = /<([A-Za-z0-9_]+)(?::(\d+)(?::[A-Za-z])?)?>/g;
  let m;
  while ((m = re.exec(body))) {
    const name = m[1].toUpperCase();
    if (name === 'EOR') { records.push(rec); rec = {}; continue; }
    const len = m[2] ? +m[2] : 0;
    rec[name] = body.substr(re.lastIndex, len);
    re.lastIndex += len;
  }
  return records;
}

// ADIF LAT/LON look like "N051 30.123".
function adifCoord(s) {
  const m = /^([NSEW])(\d{3}) (\d{1,2}(?:\.\d+)?)$/i.exec(String(s || '').trim());
  if (!m) return null;
  const v = +m[2] + +m[3] / 60;
  return /[SW]/i.test(m[1]) ? -v : v;
}

const BANDS = [[1.8, 2, '160m'], [3.5, 4, '80m'], [5.06, 5.45, '60m'], [7, 7.3, '40m'], [10.1, 10.15, '30m'],
  [14, 14.35, '20m'], [18.068, 18.168, '17m'], [21, 21.45, '15m'], [24.89, 24.99, '12m'], [28, 29.7, '10m'],
  [50, 54, '6m'], [70, 71, '4m'], [144, 148, '2m'], [430, 440, '70cm'], [1240, 1300, '23cm']];
const bandOf = (r) => {
  if (r.BAND) return r.BAND.toLowerCase().replace('cm', 'cm').replace(/^(\d+)M$/i, '$1m');
  const f = +r.FREQ;
  return (BANDS.find(([lo, hi]) => f >= lo && f <= hi) || [, , ''])[2];
};
const modeOf = (r) => {
  const mode = (r.MODE || '').toUpperCase(), sub = (r.SUBMODE || '').toUpperCase();
  if (mode === 'MFSK' && sub) return sub;           // FT4, JS8 and friends
  if (['SSB', 'USB', 'LSB'].includes(mode) || sub === 'USB' || sub === 'LSB') return 'SSB';
  return mode || sub;
};

// ---- Country centres for contacts with no locator ---------------------------------------
const world = JSON.parse(await readFile(here('node_modules/world-atlas/countries-50m.json'), 'utf8'));
const centres = new Map(feature(world, world.objects.countries).features.map((f) => [f.properties.name.toLowerCase(), geoCentroid(f)]));
// DXCC names that differ from Natural Earth's country names.
const ALIASES = {
  england: 'united kingdom', scotland: 'united kingdom', wales: 'united kingdom', 'northern ireland': 'united kingdom',
  'fed. rep. of germany': 'germany', 'united states of america': 'united states of america', 'united states': 'united states of america',
  'european russia': 'russia', 'asiatic russia': 'russia', 'czech republic': 'czechia', 'slovak republic': 'slovakia',
  'republic of korea': 'south korea', 'bosnia-herzegovina': 'bosnia and herz.', 'north macedonia': 'macedonia',
  'canary islands': 'spain', 'balearic islands': 'spain', 'madeira islands': 'portugal', azores: 'portugal',
  'sardinia': 'italy', 'sicily': 'italy', 'corsica': 'france', 'hawaii': 'united states of america', alaska: 'united states of america',
  'puerto rico': 'puerto rico', 'dominican republic': 'dominican rep.', 'kingdom of eswatini': 'eswatini',
  'republic of south africa': 'south africa', 'south africa': 'south africa', 'republic of kosovo': 'kosovo',
  'ukraine': 'ukraine', 'byelorussia': 'belarus', belarus: 'belarus', moldova: 'moldova', 'cote d\'ivoire': "côte d'ivoire",
};
function countryCentre(name) {
  if (!name) return null;
  const n = name.toLowerCase().trim();
  const c = centres.get(ALIASES[n] || n);
  return c ? { lat: c[1], lon: c[0] } : null;
}

function toContact(r) {
  // Square JJ00 (0°N 0°E, open sea) is what blank coordinates turn into, so treat it as unknown.
  const real = (p) => (p && !(p.lat >= 0 && p.lat < 1 && p.lon >= 0 && p.lon < 2) ? p : null);
  let pos = null;
  const grid = (r.GRIDSQUARE || '').trim();
  if (grid.length >= 4) pos = real(gridToLatLon(grid.slice(0, 4)));
  if (!pos) {
    const lat = adifCoord(r.LAT), lon = adifCoord(r.LON);
    if (lat != null && lon != null) pos = real({ lat, lon });
  }
  if (!pos) pos = countryCentre(r.COUNTRY);
  if (!pos || !r.CALL) return null;
  const d = (r.QSO_DATE || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  const c = { c: r.CALL.toUpperCase(), b: bandOf(r), m: modeOf(r), d, g: latLonToGrid4(pos.lat, pos.lon) };
  if (r.DXCC) c.dx = +r.DXCC;
  else if (r.COUNTRY) c.dx = r.COUNTRY.trim();   // still counts as an entity in the stats
  if (r.CONT) c.ct = r.CONT.toUpperCase();
  return c;
}

// ---- QRZ Logbook API ------------------------------------------------------------------
async function loadKey() {
  if (process.env.QRZ_LOGBOOK_KEY) return process.env.QRZ_LOGBOOK_KEY.trim();
  const env = await readFile(here('.env'), 'utf8').catch(() => '');
  const m = /^\s*QRZ_LOGBOOK_KEY\s*=\s*"?([^"\n]+)"?\s*$/m.exec(env);
  if (!m) throw new Error('No QRZ_LOGBOOK_KEY found in the environment or in .env');
  return m[1].trim();
}

function parseQrzResponse(text) {
  // name=value pairs joined by "&"; the ADIF value itself contains "&lt;" style entities.
  const out = {};
  for (const part of text.split(/&(?=[A-Z_]+=)/)) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}
const unescape = (s) => (/%3C/i.test(s) ? decodeURIComponent(s.replace(/\+/g, ' ')) : s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

async function fetchQrz() {
  const key = await loadKey();
  const records = [];
  let after = 0;
  for (let page = 0; page < 400; page++) {
    const body = new URLSearchParams({ KEY: key, ACTION: 'FETCH', OPTION: `MAX:250,AFTERLOGID:${after}` });
    const res = await fetch('https://logbook.qrz.com/api', {
      method: 'POST', body,
      headers: { 'user-agent': `QSOGlobe/0.1 (${config.callsign || 'unknown'})` },
    });
    const r = parseQrzResponse(await res.text());
    if (r.RESULT === 'FAIL' && /no.*(result|record)/i.test(r.REASON || '')) break;
    if (r.RESULT !== 'OK') throw new Error(`QRZ Logbook said: ${r.RESULT} ${r.REASON || ''}`.trim());
    const batch = r.ADIF ? parseAdif(unescape(r.ADIF)) : [];
    records.push(...batch);
    const ids = (r.LOGIDS || '').split(',').map(Number).filter(Boolean);
    if (!batch.length || !ids.length || batch.length < 250) break;
    after = Math.max(...ids) + 1;
    process.stdout.write(`\rFetched ${records.length} contacts…`);
  }
  process.stdout.write('\n');
  return records;
}

// ---- Main -----------------------------------------------------------------------------
let records;
if (arg('adif')) records = parseAdif(await readFile(arg('adif'), 'latin1'));
else if (arg('qrz')) records = await fetchQrz();
else {
  console.log('Usage: node scripts/import.mjs --adif mylog.adi   or   node scripts/import.mjs --qrz');
  process.exit(1);
}

const contacts = [];
const unplaced = [];
for (const r of records) {
  const c = toContact(r);
  if (c) contacts.push(c); else if (r.CALL) unplaced.push(r.CALL);
}
contacts.sort((a, b) => a.d.localeCompare(b.d));
await mkdir(here('site/'), { recursive: true });
await writeFile(here('site/contacts.json'), JSON.stringify({
  station: { callsign: config.callsign, locator: config.locator, title: config.title },
  generated: new Date().toISOString(), sample: false, contacts,
}));
console.log(`Wrote ${contacts.length} contacts to site/contacts.json` +
  (unplaced.length ? `; ${unplaced.length} had no usable location (${unplaced.slice(0, 8).join(', ')}${unplaced.length > 8 ? ', …' : ''})` : ''));
