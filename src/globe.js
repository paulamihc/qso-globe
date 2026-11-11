// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Paul Friend
// QSO Globe: a slowly turning globe of the stations you have worked.
import { geoOrthographic, geoPath, geoGraticule10, geoInterpolate, geoDistance } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import world from 'world-atlas/countries-110m.json';
import { gridToLatLon, distanceKm, roughContinent } from './geo.js';

// ---- Settings from the URL --------------------------------------------------------------
const params = new URLSearchParams(location.search);
const RENDER = params.has('render');                 // headless frame rendering for the animated image
const DATA_URL = params.get('data') || 'contacts.json';
const TURN_SECONDS = +params.get('turn') || 15;      // seconds per full turn
const COLOUR_BY = params.get('colour') === 'mode' ? 'mode' : 'band';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const BAND_ORDER = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '4m', '2m', '70cm', '23cm', 'SAT'];
const BAND_COLOURS = {
  '160m': '#ff4d6d', '80m': '#ff7b47', '60m': '#ff9f43', '40m': '#ffc93c', '30m': '#d4f04a', '20m': '#4be3a0',
  '17m': '#2fd6e8', '15m': '#45a8ff', '12m': '#7c8cff', '10m': '#b57bff', '6m': '#ff6ad5', '4m': '#ff9ad8',
  '2m': '#f1f5ff', '70cm': '#c9d3e6', '23cm': '#a8b4c8', SAT: '#ffe28a',
};
const MODE_COLOURS = { FT8: '#4be3a0', FT4: '#2fd6e8', SSB: '#ffc93c', CW: '#ff7b47', FM: '#b57bff', RTTY: '#ff6ad5', PSK31: '#45a8ff' };
const OTHER = '#9fb3c8';
const HOME_COLOUR = '#ffd166';
const CONTINENTS = { EU: 'Europe', AS: 'Asia', AF: 'Africa', NA: 'North America', SA: 'South America', OC: 'Oceania', AN: 'Antarctica' };

// ---- Page elements ----------------------------------------------------------------------
const stage = document.getElementById('stage');
const canvas = document.getElementById('globe');
const ctx = canvas.getContext('2d');
const tip = document.getElementById('tip');
if (RENDER) document.documentElement.classList.add('render');

// ---- Map geometry -----------------------------------------------------------------------
const land = feature(world, world.objects.land);
const borders = mesh(world, world.objects.countries, (a, b) => a !== b);
const graticule = geoGraticule10();
const projection = geoOrthographic().clipAngle(90).precision(0.6);
const flat = geoOrthographic();                       // same view, no clipping, for arcs above the surface
const path = geoPath(projection, ctx);

// ---- State ------------------------------------------------------------------------------
let W = 0, H = 0, R = 0, CX = 0, CY = 0, dpr = 1;
let lambda = 0, phi = -28;                           // rotation; centre latitude is -phi
let home, points = [], recent = [], stars = [];
let hovered = null, pinned = null, screenPins = [];
let dragging = null, idleUntil = 0, velocity = 0;
const sprites = new Map();

// ---- Helpers ----------------------------------------------------------------------------
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function ukDate(iso, short = false) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || '';
  const m = MONTHS[d.getUTCMonth()];
  return `${ordinal(d.getUTCDate())} ${short ? m.slice(0, 3) : m} ${d.getUTCFullYear()}`;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const colourOf = (c) => (COLOUR_BY === 'mode' ? MODE_COLOURS[c.m] : BAND_COLOURS[c.b]) || OTHER;
const fmt = (n) => n.toLocaleString('en-GB');

function sprite(colour) {
  if (sprites.has(colour)) return sprites.get(colour);
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d'), grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, colour);
  grad.addColorStop(0.18, colour + 'cc');
  grad.addColorStop(0.45, colour + '33');
  grad.addColorStop(1, colour + '00');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  sprites.set(colour, c);
  return c;
}

// Deterministic stars, so every rendered frame has the same sky.
function makeStars() {
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  stars = Array.from({ length: Math.round((W * H) / 2600) }, () => ({ x: r() * W, y: r() * H, a: 0.15 + r() * 0.5, s: r() < 0.08 ? 1.3 : 0.7 }));
}

// ---- Data -------------------------------------------------------------------------------
async function load() {
  const res = await fetch(DATA_URL, { cache: 'no-cache' });
  const data = await res.json();
  const st = data.station || {};
  home = gridToLatLon(st.locator) || { lat: 0, lon: 0 };
  home.grid = st.locator;

  const byGrid = new Map();
  const dxcc = new Set(), conts = new Set(), bands = new Map();
  let odx = null;
  for (const c of data.contacts || []) {
    const pos = c.lat != null && c.lon != null ? { lat: +c.lat, lon: +c.lon } : gridToLatLon(c.g);
    if (!pos) continue;
    const key = c.g || `${pos.lat.toFixed(1)},${pos.lon.toFixed(1)}`;
    let p = byGrid.get(key);
    if (!p) {
      p = { key, lat: pos.lat, lon: pos.lon, coords: [pos.lon, pos.lat], list: [], dist: distanceKm(home, pos) };
      p.arc = geoInterpolate([home.lon, home.lat], p.coords);
      p.angle = p.dist / 6371;
      byGrid.set(key, p);
    }
    p.list.push(c);
    if (c.dx) dxcc.add(c.dx);
    conts.add(c.ct || roughContinent(pos.lat, pos.lon));
    bands.set(c.b, (bands.get(c.b) || 0) + 1);
    if (!odx || p.dist > odx.dist) odx = { dist: p.dist, call: c.c };
  }
  points = [...byGrid.values()];
  for (const p of points) {
    p.list.sort((a, b) => String(b.d).localeCompare(String(a.d)));
    p.colour = colourOf(p.list[0]);
    p.size = 1.5 + Math.min(2.2, Math.log2(p.list.length) * 0.55);
  }
  // Far points last, so they sit on top of the crowded areas near home.
  points.sort((a, b) => a.dist - b.dist);
  recent = [...points].sort((a, b) => String(b.list[0].d).localeCompare(String(a.list[0].d))).slice(0, 14);

  // Start the turn with home in view.
  lambda = -home.lon - 25;

  // Header, stats and legend.
  document.getElementById('call').textContent = st.callsign || '';
  document.getElementById('sub').textContent = [st.title || 'Stations worked', st.locator].filter(Boolean).join(' · ');
  const total = (data.contacts || []).length;
  const stats = [
    [fmt(total), total === 1 ? 'contact' : 'contacts'],
    [fmt(dxcc.size), 'DXCC entities'],
    [conts.size, conts.size === 1 ? 'continent' : 'continents'],
    [odx ? fmt(Math.round(odx.dist)) + ' km' : '–', 'best DX'],
  ];
  document.getElementById('stats').innerHTML = stats.map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
  const legendKeys = COLOUR_BY === 'mode'
    ? [...new Set((data.contacts || []).map((c) => c.m))].sort()
    : BAND_ORDER.filter((b) => bands.has(b)).concat([...bands.keys()].filter((b) => !BAND_ORDER.includes(b)));
  document.getElementById('legend').innerHTML = legendKeys.map((k) => {
    const col = (COLOUR_BY === 'mode' ? MODE_COLOURS[k] : BAND_COLOURS[k]) || OTHER;
    return `<span><i style="background:${col};box-shadow:0 0 6px ${col}"></i>${esc(k)}</span>`;
  }).join('');
  document.getElementById('updated').textContent =
    (data.sample ? 'Sample data · ' : '') + 'Updated ' + ukDate(data.generated);
}

// ---- Layout -----------------------------------------------------------------------------
function resize() {
  const r = stage.getBoundingClientRect();
  W = r.width; H = r.height;
  dpr = RENDER ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const top = document.querySelector('.top').getBoundingClientRect().bottom - r.top;
  const bottom = r.bottom - document.querySelector('.bottom').getBoundingClientRect().top;
  const free = H - top - bottom;
  R = Math.max(40, Math.min(W * 0.44, free * 0.44, 520));
  CX = W / 2;
  CY = top + free / 2;
  for (const p of [projection, flat]) p.scale(R).translate([CX, CY]);
  makeStars();
}

// ---- Drawing ----------------------------------------------------------------------------
function draw(phase) {
  projection.rotate([lambda, phi]);
  flat.rotate([lambda, phi]);
  const centre = [-lambda, -phi];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Sky
  ctx.globalCompositeOperation = 'source-over';
  for (const s of stars) {
    ctx.fillStyle = `rgba(200,220,255,${s.a})`;
    ctx.fillRect(s.x, s.y, s.s, s.s);
  }

  // Atmosphere glow
  let g = ctx.createRadialGradient(CX, CY, R * 0.92, CX, CY, R * 1.22);
  g.addColorStop(0, 'rgba(70,150,255,0.55)');
  g.addColorStop(0.25, 'rgba(60,130,255,0.18)');
  g.addColorStop(1, 'rgba(40,90,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(CX, CY, R * 1.22, 0, Math.PI * 2); ctx.fill();

  // Ocean
  g = ctx.createRadialGradient(CX - R * 0.35, CY - R * 0.4, R * 0.05, CX, CY, R);
  g.addColorStop(0, '#1b4a80');
  g.addColorStop(0.55, '#0b2346');
  g.addColorStop(1, '#050f22');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.fill();

  // Grid lines, land and borders
  ctx.beginPath(); path(graticule);
  ctx.strokeStyle = 'rgba(140,185,255,0.08)'; ctx.lineWidth = 0.6; ctx.stroke();
  ctx.beginPath(); path(land);
  ctx.fillStyle = 'rgba(78,132,190,0.55)'; ctx.fill();
  ctx.strokeStyle = 'rgba(150,200,250,0.45)'; ctx.lineWidth = 0.6; ctx.stroke();
  ctx.beginPath(); path(borders);
  ctx.strokeStyle = 'rgba(150,200,250,0.16)'; ctx.lineWidth = 0.5; ctx.stroke();

  // Shading towards the edge for depth
  g = ctx.createRadialGradient(CX - R * 0.25, CY - R * 0.3, R * 0.3, CX, CY, R);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.75, 'rgba(0,5,20,0.2)');
  g.addColorStop(1, 'rgba(0,5,20,0.6)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.fill();

  ctx.globalCompositeOperation = 'lighter';

  // Arcs from home, lifted above the surface
  const focus = pinned || hovered;
  ctx.lineCap = 'round';
  const byColour = new Map();
  for (const p of points) {
    if (p.dist < 250) continue;
    if (!byColour.has(p.colour)) byColour.set(p.colour, []);
    byColour.get(p.colour).push(p);
  }
  for (const [colour, list] of byColour) {
    ctx.beginPath();
    for (const p of list) traceArc(p, centre);
    ctx.strokeStyle = colour + (focus ? '1c' : '3c');
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  if (focus && focus.dist >= 30) {
    ctx.beginPath(); traceArc(focus, centre);
    ctx.strokeStyle = focus.colour; ctx.lineWidth = 1.8; ctx.stroke();
  }

  // Travelling sparks on the most recent contacts
  for (let i = 0; i < recent.length; i++) {
    const p = recent[i];
    if (p.dist < 30) continue;
    const t = (phase * 4 + i / recent.length) % 1;
    const s = arcPoint(p, t, centre);
    if (!s.visible) continue;
    const size = 9;
    ctx.globalAlpha = Math.sin(Math.PI * t);
    ctx.drawImage(sprite(p.colour), s.x - size, s.y - size, size * 2, size * 2);
    ctx.globalAlpha = 1;
  }

  // Pins
  screenPins = [];
  for (const p of points) {
    const z = Math.cos(geoDistance(p.coords, centre));
    if (z <= 0.02) continue;
    const [x, y] = flat(p.coords);
    const a = Math.min(1, 0.25 + z);
    const r = p.size * (0.7 + 0.3 * z) * (p === focus ? 1.6 : 1);
    ctx.globalAlpha = a * 0.7;
    const gr = p.dist < 1500 ? r * 2.6 : r * 4;
    ctx.drawImage(sprite(p.colour), x - gr, y - gr, gr * 2, gr * 2);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = a * 0.9;
    ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    screenPins.push({ p, x, y });
  }

  // Home station
  const hz = Math.cos(geoDistance([home.lon, home.lat], centre));
  if (hz > 0) {
    const [x, y] = flat([home.lon, home.lat]);
    const q = (phase * 8) % 1;
    ctx.strokeStyle = HOME_COLOUR;
    ctx.globalAlpha = (1 - q) * 0.9;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 3 + q * 14, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.drawImage(sprite(HOME_COLOUR), x - 14, y - 14, 28, 28);
    ctx.fillStyle = '#fff8e0';
    ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
  }

  // Focus ring
  if (focus) {
    const sp = screenPins.find((s) => s.p === focus);
    if (sp) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, focus.size * 3 + 3, 0, Math.PI * 2); ctx.stroke();
      placeTip(sp);
    } else hideTip();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function lift(p) { return 0.04 + Math.min(0.22, p.angle * 0.1); }

function arcPoint(p, t, centre) {
  const ll = p.arc(t);
  const z = Math.cos(geoDistance(ll, centre));
  const [x0, y0] = flat(ll);
  const k = 1 + lift(p) * Math.sin(Math.PI * t);
  const x = CX + (x0 - CX) * k, y = CY + (y0 - CY) * k;
  const visible = z >= 0 || k * Math.sqrt(Math.max(0, 1 - z * z)) >= 1;
  return { x, y, visible };
}

function traceArc(p, centre) {
  const n = Math.max(12, Math.min(64, Math.round(p.angle * 20)));
  let drawing = false;
  for (let i = 0; i <= n; i++) {
    const s = arcPoint(p, i / n, centre);
    if (!s.visible) { drawing = false; continue; }
    if (drawing) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
    drawing = true;
  }
}

// ---- Tooltip ----------------------------------------------------------------------------
function tipHtml(p) {
  const rows = p.list.slice(0, 6).map((c) => {
    const col = colourOf(c);
    return `<div class="row"><b>${esc(c.c)}</b><span class="chip" style="--c:${col}">${esc(c.b)}</span>` +
      `<span>${esc(c.m)}</span><span class="date">${esc(ukDate(c.d, true))}</span></div>`;
  }).join('');
  const more = p.list.length > 6 ? `<div class="more">and ${p.list.length - 6} more</div>` : '';
  const where = p.list[0].g ? `${esc(p.list[0].g)} · ` : '';
  return `<div class="head">${where}${fmt(Math.round(p.dist))} km</div>${rows}${more}`;
}
let tipFor = null;
function placeTip(sp) {
  if (tipFor !== sp.p) { tip.innerHTML = tipHtml(sp.p); tipFor = sp.p; }
  tip.hidden = false;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = sp.x + 14, y = sp.y - th / 2;
  if (x + tw > W - 6) x = sp.x - tw - 14;
  y = Math.max(6, Math.min(H - th - 6, y));
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
function hideTip() { tip.hidden = true; tipFor = null; }

function nearest(x, y, radius) {
  let best = null, bd = radius * radius;
  for (const s of screenPins) {
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < bd) { bd = d; best = s.p; }
  }
  return best;
}

// ---- Interaction ------------------------------------------------------------------------
function local(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
canvas.addEventListener('pointerdown', (e) => {
  const [x, y] = local(e);
  dragging = { x, y, x0: x, y0: y, t: performance.now(), moved: false, type: e.pointerType };
  velocity = 0;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  const [x, y] = local(e);
  if (dragging) {
    const dx = x - dragging.x, dy = y - dragging.y;
    if (Math.hypot(x - dragging.x0, y - dragging.y0) > 4) dragging.moved = true;
    if (dragging.moved) {
      const k = 90 / R;
      lambda += dx * k;
      phi = Math.max(-75, Math.min(75, phi - dy * k));
      const now = performance.now();
      velocity = (dx * k) / Math.max(8, now - dragging.t) * 16;
      dragging.t = now;
      pinned = null;
      hideTip();
    }
    dragging.x = x; dragging.y = y;
    idleUntil = performance.now() + 4000;
  } else if (e.pointerType === 'mouse') {
    const p = nearest(x, y, 12);
    if (p !== hovered) { hovered = p; if (!p && !pinned) hideTip(); }
    canvas.style.cursor = p ? 'pointer' : 'grab';
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (dragging && !dragging.moved) {
    const [x, y] = local(e);
    const p = nearest(x, y, dragging.type === 'mouse' ? 12 : 22);
    pinned = p && p !== pinned ? p : null;
    if (!pinned) hideTip();
    idleUntil = performance.now() + (pinned ? 8000 : 0);
  }
  dragging = null;
});
canvas.addEventListener('pointerleave', () => { hovered = null; if (!pinned) hideTip(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') { pinned = null; hideTip(); } });

// ---- Run --------------------------------------------------------------------------------
let last = performance.now(), phase = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const spinning = !dragging && !hovered && !pinned && now > idleUntil && !REDUCED;
  if (Math.abs(velocity) > 0.01 && !dragging) { lambda += velocity; velocity *= 0.94; }
  if (spinning) lambda += (dt * 360) / TURN_SECONDS;
  phase = (phase + dt / 16) % 1;               // sparks and the home pulse keep their own pace
  draw(phase);
  requestAnimationFrame(frame);
}

// Used by scripts/render-gif.mjs: draws frame i of n of one seamless full turn.
let lambda0 = 0;
window.renderFrame = (i, n) => {
  lambda = lambda0 + (360 * i) / n;
  draw(i / n);
};

await load();
resize();
if (RENDER) {
  lambda0 = lambda;
  document.documentElement.dataset.ready = '1';
} else {
  addEventListener('resize', resize);
  requestAnimationFrame(frame);
}
