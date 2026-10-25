import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';

interface BuildEntry {
  entry: string;
  outdir: string;
  naming: string;
  target: 'browser' | 'node';
  format: 'iife' | 'esm';
}

interface LibraryRecord {
  file: string;
  bytes: number;
  sha256: string;
}

const LIBRARY_SET = 'canvas-2026-10';
const LIBRARY_DIR = 'viewer/libraries';

const entries: BuildEntry[] = [
  { entry: 'panel/main.ts', outdir: 'panel', naming: 'main.js', target: 'browser', format: 'iife' },
  { entry: 'panel/page.ts', outdir: 'panel', naming: 'page.js', target: 'browser', format: 'iife' },
  { entry: 'status/main.ts', outdir: 'status', naming: 'main.js', target: 'browser', format: 'iife' },
  { entry: 'src/service/main.ts', outdir: 'service', naming: 'main.js', target: 'node', format: 'esm' },
  { entry: 'src/mcp/server.ts', outdir: 'mcp', naming: 'server.js', target: 'node', format: 'esm' },
  { entry: 'src/viewer/server.ts', outdir: 'viewer', naming: 'server.js', target: 'node', format: 'esm' },
  {
    entry: 'src/viewer/runtime/canvas.ts',
    outdir: 'viewer/runtime',
    naming: 'canvas.js',
    target: 'browser',
    format: 'iife',
  },
];

const libraries = [
  { name: 'chartjs', source: 'node_modules/chart.js/dist/chart.umd.min.js', file: 'chartjs.js' },
  { name: 'd3', source: 'node_modules/d3/dist/d3.min.js', file: 'd3.js' },
  { name: 'mermaid', source: 'node_modules/mermaid/dist/mermaid.min.js', file: 'mermaid.js' },
];

let built = 0;

for (const item of entries) {
  if (!existsSync(item.entry)) continue;
  const result = await Bun.build({
    entrypoints: [item.entry],
    outdir: item.outdir,
    naming: item.naming,
    target: item.target,
    format: item.format,
    sourcemap: 'none',
  });
  if (!result.success) {
    console.error(`Build failed for ${item.entry}`);
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  built += 1;
  console.log(`Built ${item.entry} -> ${item.outdir}/${item.naming}`);
}

if (built === 0) {
  console.log('No extension entries yet. Phase 1 ships the store and the view policy only.');
}

const manifest: { schema: 1; set: string; libraries: Record<string, LibraryRecord> } = {
  schema: 1,
  set: LIBRARY_SET,
  libraries: {},
};

await mkdir(LIBRARY_DIR, { recursive: true });
for (const library of libraries) {
  if (!existsSync(library.source)) {
    console.error(`Missing library source: ${library.source}`);
    process.exitCode = 1;
    continue;
  }
  const bytes = new Uint8Array(await Bun.file(library.source).arrayBuffer());
  await Bun.write(path.join(LIBRARY_DIR, library.file), bytes);
  manifest.libraries[library.name] = {
    file: library.file,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  console.log(`Copied ${library.name} -> ${LIBRARY_DIR}/${library.file}`);
}
await Bun.write(path.join(LIBRARY_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const identity = createHash('sha256');
for (const filename of ['viewer/server.js', 'viewer/runtime/canvas.js', 'viewer/libraries/manifest.json']) {
  identity.update(new Uint8Array(await Bun.file(filename).arrayBuffer()));
}
await Bun.write('viewer/build.json', `${JSON.stringify({ protocol: 2, id: identity.digest('hex') })}\n`);
