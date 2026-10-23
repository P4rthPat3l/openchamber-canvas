import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const FALLBACK_VERSION = '0.0.0';
const MAX_DEPTH = 4;

/**
 * Source runs version.ts from `src/mcp` (two levels below the package root),
 * while bundles run from `mcp/`, `service/`, and `viewer/` (one level below).
 * Walk up so both layouts read the same package.json.
 */
export function versionFrom(startDir: string): string {
  let dir = startDir;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const candidate = path.join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: unknown };
        if (typeof parsed.version === 'string' && parsed.version.length > 0) {
          return parsed.version;
        }
      } catch {
        // Keep walking: a malformed candidate higher up must not crash the service.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return FALLBACK_VERSION;
}

export const MCP_VERSION: string = versionFrom(path.dirname(fileURLToPath(import.meta.url)));
