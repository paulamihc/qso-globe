// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Paul Friend
// Maidenhead locators, distances and rough continents. Shared by the page and the importer.

const A = 'A'.charCodeAt(0);

/** Centre of a Maidenhead locator (2, 4, 6 or 8 characters) as {lat, lon}, or null. */
export function gridToLatLon(grid) {
  if (!grid) return null;
  const g = String(grid).trim().toUpperCase();
  if (!/^[A-R]{2}([0-9]{2}([A-X]{2}([0-9]{2})?)?)?$/.test(g)) return null;
  let lon = -180 + (g.charCodeAt(0) - A) * 20;
  let lat = -90 + (g.charCodeAt(1) - A) * 10;
  let w = 20, h = 10;
  if (g.length >= 4) { w = 2; h = 1; lon += +g[2] * w; lat += +g[3] * h; }
  if (g.length >= 6) { w /= 24; h /= 24; lon += (g.charCodeAt(4) - A) * w; lat += (g.charCodeAt(5) - A) * h; }
  if (g.length >= 8) { w /= 10; h /= 10; lon += +g[6] * w; lat += +g[7] * h; }
  return { lat: lat + h / 2, lon: lon + w / 2 };
}

/** Four-character Maidenhead locator for a position. */
export function latLonToGrid4(lat, lon) {
  const x = Math.min(Math.max(lon + 180, 0), 359.999);
  const y = Math.min(Math.max(lat + 90, 0), 179.999);
  return String.fromCharCode(A + Math.floor(x / 20), A + Math.floor(y / 10)) +
    Math.floor((x % 20) / 2) + Math.floor(y % 10);
}

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Very rough continent from a position, used only when the log has no CONT field. */
export function roughContinent(lat, lon) {
  if (lat < -60) return 'AN';
  if (lon >= -170 && lon <= -30 && lat >= 13) return 'NA';
  if (lon >= -120 && lon <= -60 && lat >= 7 && lat < 13) return 'NA';
  if (lon >= -92 && lon <= -30 && lat < 13) return 'SA';
  if (lon >= -30 && lon <= 60 && lat >= 35) return lon > 40 && lat < 42 ? 'AS' : 'EU';
  if (lon >= -20 && lon <= 52 && lat < 37) return lon > 34 && lat > 12 ? 'AS' : 'AF';
  if (lon >= 110 && lat <= -10) return 'OC';
  if (lon >= 130 || lon <= -140) return lat < 0 || lon < -140 ? 'OC' : 'AS';
  return 'AS';
}
