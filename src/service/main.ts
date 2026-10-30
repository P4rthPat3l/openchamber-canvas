import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ArtifactStore } from '../store/index';
import { defaultStoreRoot, defaultViewerPortFile } from '../store/paths';
import { createServiceServer } from './routes';
import { installedRendering, packageRoot } from '../viewer/rendering';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
  const token = process.env.OPENCHAMBER_SERVICE_TOKEN;
  if (!Number.isInteger(port) || port <= 0) {
    console.error('[canvas service] OPENCHAMBER_SERVICE_PORT is missing or invalid');
    process.exit(1);
  }
  if (token === undefined || token.length === 0) {
    console.error('[canvas service] OPENCHAMBER_SERVICE_TOKEN is missing');
    process.exit(1);
  }

  const configuredStore = process.env.CANVAS_STORE?.trim();
  const storeRoot =
    configuredStore !== undefined && configuredStore.length > 0
      ? path.resolve(configuredStore)
      : defaultStoreRoot();
  const configuredPortFile = process.env.CANVAS_VIEWER_PORT_FILE?.trim();
  const portFile =
    configuredPortFile !== undefined && configuredPortFile.length > 0
      ? path.resolve(configuredPortFile)
      : defaultViewerPortFile(storeRoot);
  const configuredViewerEntry = process.env.CANVAS_VIEWER_ENTRY?.trim();
  const viewerEntry =
    configuredViewerEntry !== undefined && configuredViewerEntry.length > 0
      ? path.resolve(configuredViewerEntry)
      : path.join(moduleDir, '..', 'viewer', 'server.js');
  const parsedTimeout = Number(process.env.CANVAS_VIEWER_TIMEOUT_MS ?? '');
  const viewerTimeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 15_000;

  const store = new ArtifactStore({ root: storeRoot, renderingSource: installedRendering() });
  await store.init();
  const service = await createServiceServer({
    store,
    token,
    storeRoot,
    portFile,
    viewerEntry,
    pluginPath: packageRoot(),
    viewerTimeoutMs,
    host: '127.0.0.1',
    port,
  });
  console.error(`[canvas service] listening on ${service.port}`);

  const shutdown = () => {
    void service.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await service.closed;
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
