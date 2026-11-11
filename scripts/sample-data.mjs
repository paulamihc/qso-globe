// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Paul Friend
// Writes made-up sample contacts so the globe can be previewed without a real log.
// Usage: node scripts/sample-data.mjs [count]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { latLonToGrid4, gridToLatLon } from '../src/geo.js';

const count = +process.argv[2] || 360;
const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url)).catch(() =>
  readFile(new URL('../config.example.json', import.meta.url))));

// Seeded random so the sample (and the rendered GIF) is the same every run.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const weighted = (arr) => {
  const total = arr.reduce((s, x) => s + x.w, 0);
  let r = rnd() * total;
  for (const x of arr) if ((r -= x.w) < 0) return x;
  return arr[arr.length - 1];
};

// [prefix, dxcc, continent, lat, lon, spread in degrees, weight]
const AREAS = [
  ['G', 223, 'EU', 52.5, -1.5, 2, 10], ['GM', 279, 'EU', 56.8, -4.2, 1.5, 3], ['GI', 265, 'EU', 54.6, -6.6, 0.6, 1],
  ['EI', 245, 'EU', 53.2, -7.9, 1.2, 4], ['F', 227, 'EU', 46.6, 2.4, 3, 9], ['DL', 230, 'EU', 51, 10, 2.5, 14],
  ['PA', 263, 'EU', 52.2, 5.5, 0.8, 6], ['ON', 209, 'EU', 50.6, 4.6, 0.6, 4], ['EA', 281, 'EU', 40.2, -3.7, 3, 7],
  ['CT', 272, 'EU', 39.6, -8.1, 1.2, 3], ['I', 248, 'EU', 42.8, 12.5, 3, 8], ['HB9', 287, 'EU', 46.8, 8.2, 0.6, 2],
  ['OE', 206, 'EU', 47.5, 14.5, 1, 3], ['OK', 503, 'EU', 49.8, 15.4, 1, 4], ['SP', 269, 'EU', 52, 19.4, 2, 7],
  ['OZ', 221, 'EU', 56, 9.5, 1, 3], ['SM', 284, 'EU', 60.5, 16, 4, 4], ['LA', 266, 'EU', 61, 9, 4, 3],
  ['OH', 224, 'EU', 63, 26, 3, 3], ['ES', 52, 'EU', 58.7, 25.5, 0.8, 1], ['YL', 145, 'EU', 56.9, 24.6, 0.8, 1],
  ['LY', 146, 'EU', 55.3, 23.9, 0.8, 1], ['UR', 288, 'EU', 49, 31, 3, 4], ['YO', 275, 'EU', 45.9, 24.9, 1.5, 3],
  ['LZ', 212, 'EU', 42.7, 25.3, 1, 2], ['SV', 236, 'EU', 39, 22, 2, 2], ['9A', 497, 'EU', 45.3, 16, 0.8, 2],
  ['S5', 499, 'EU', 46.1, 14.8, 0.4, 1], ['HA', 239, 'EU', 47.2, 19.4, 1, 3], ['TF', 242, 'EU', 64.9, -19, 1.5, 1],
  ['UA', 54, 'EU', 55.7, 40, 5, 4], ['UA9', 15, 'AS', 56, 70, 10, 2], ['4X', 336, 'AS', 31.5, 34.9, 0.6, 1],
  ['A6', 391, 'AS', 24.4, 54.4, 0.6, 1], ['VU', 324, 'AS', 21, 78, 5, 1], ['JA', 339, 'AS', 36, 138, 3, 4],
  ['BY', 318, 'AS', 32, 114, 8, 1], ['HL', 137, 'AS', 36.5, 127.8, 1, 1], ['YB', 327, 'OC', -6.5, 107, 4, 1],
  ['VK', 150, 'OC', -32, 145, 6, 3], ['ZL', 170, 'OC', -40, 175, 2, 1], ['KH6', 110, 'OC', 20.8, -157, 0.8, 0.5],
  ['W', 291, 'NA', 39, -88, 12, 10], ['VE', 1, 'NA', 46, -73, 6, 4], ['XE', 50, 'NA', 21, -100, 4, 1],
  ['KP4', 202, 'NA', 18.2, -66.4, 0.3, 1], ['CO', 70, 'NA', 22, -79.5, 1, 0.5], ['VP9', 64, 'NA', 32.3, -64.8, 0.1, 0.4],
  ['PY', 108, 'SA', -20, -46, 6, 3], ['LU', 100, 'SA', -34, -62, 5, 2], ['CE', 112, 'SA', -33.5, -70.7, 2, 1],
  ['HK', 116, 'SA', 4.6, -74, 2, 0.6], ['YV', 148, 'SA', 9, -66, 2, 0.6], ['ZS', 462, 'AF', -29, 25, 4, 1.5],
  ['CN', 446, 'AF', 32, -6.5, 1.5, 1], ['EA8', 29, 'AF', 28.3, -16, 0.6, 1.5], ['5B', 215, 'AS', 35, 33.2, 0.3, 1],
  ['SU', 478, 'AF', 30, 31.2, 1, 0.5], ['5Z', 430, 'AF', -1.3, 36.8, 1, 0.4], ['D2', 401, 'AF', -8.8, 13.2, 0.5, 0.3],
  ['KL7', 6, 'NA', 61.2, -149.9, 2, 0.4], ['VP8', 141, 'SA', -51.7, -59, 0.3, 0.2], ['3B8', 165, 'AF', -20.2, 57.5, 0.2, 0.3],
];
const BANDS = [
  { b: '40m', w: 18 }, { b: '20m', w: 26 }, { b: '15m', w: 14 }, { b: '10m', w: 14 }, { b: '17m', w: 7 },
  { b: '30m', w: 6 }, { b: '80m', w: 6 }, { b: '12m', w: 3 }, { b: '6m', w: 4 }, { b: '2m', w: 2 }, { b: '160m', w: 1 },
];
const MODES = [{ m: 'FT8', w: 60 }, { m: 'FT4', w: 12 }, { m: 'SSB', w: 18 }, { m: 'CW', w: 6 }, { m: 'FM', w: 2 }, { m: 'RTTY', w: 2 }];

const home = gridToLatLon(config.locator);
const contacts = [];
for (let i = 0; i < count; i++) {
  const area = weighted(AREAS.map(([p, dx, ct, lat, lon, s, w]) => ({ p, dx, ct, lat, lon, s, w })));
  const lat = Math.max(-85, Math.min(85, area.lat + (rnd() - 0.5) * 2 * area.s));
  const lon = area.lon + (rnd() - 0.5) * 2 * area.s * 1.4;
  let band = weighted(BANDS).b;
  // VHF only reaches nearby stations.
  if ((band === '2m' || band === '6m') && Math.hypot(lat - home.lat, lon - home.lon) > (band === '2m' ? 4 : 25)) band = '20m';
  const mode = band === '2m' && rnd() < 0.6 ? 'FM' : weighted(MODES).m;
  const digit = area.p.match(/\d$/) ? '' : Math.floor(rnd() * 10);
  const suffix = Array.from({ length: 2 + Math.floor(rnd() * 2) }, () => String.fromCharCode(65 + Math.floor(rnd() * 26))).join('');
  const day = new Date(Date.UTC(2025, 9, 1) + Math.floor(rnd() * 405) * 86400000);
  contacts.push({
    c: `${area.p}${digit}${suffix}`, b: band, m: mode, d: day.toISOString().slice(0, 10),
    g: latLonToGrid4(lat, lon), dx: area.dx, ct: area.ct,
  });
}
contacts.sort((a, b) => a.d.localeCompare(b.d));

await mkdir(new URL('../site/', import.meta.url), { recursive: true });
await writeFile(new URL('../site/contacts.json', import.meta.url), JSON.stringify({
  station: { callsign: config.callsign, locator: config.locator, title: config.title },
  generated: new Date().toISOString(), sample: true, contacts,
}));
console.log(`Wrote ${contacts.length} sample contacts to site/contacts.json`);
