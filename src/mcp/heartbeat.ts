import * as path from 'node:path';

import { writeJsonAtomic } from '../store/fs';

const MCP_VERSION = '0.1.0';
const HEARTBEAT_MS = 60_000;

export function startHeartbeat(storeRoot: string): () => void {
  const file = path.join(storeRoot, '.mcp-heartbeat.json');
  const write = (): void => {
    void writeJsonAtomic(file, {
      seenAt: new Date().toISOString(),
      pid: process.pid,
      version: MCP_VERSION,
    }).catch(() => undefined);
  };
  write();
  const timer = setInterval(write, HEARTBEAT_MS);
  timer.unref();
  return () => clearInterval(timer);
}
