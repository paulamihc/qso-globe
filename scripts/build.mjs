// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Paul Friend
// Bundles src/globe.js (with the map data) into site/globe.js.
import { build } from 'esbuild';
await build({
  entryPoints: ['src/globe.js'], bundle: true, minify: true, format: 'esm', target: 'es2022',
  outfile: 'site/globe.js', legalComments: 'eof', logLevel: 'info',
  banner: { js: '/* QSO Globe · Copyright 2026 Paul Friend · Apache License 2.0 · map data Natural Earth (public domain) via world-atlas (ISC) */' },
});
