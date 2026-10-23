import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageJsonPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'package.json',
);
const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string };

export const MCP_VERSION: string = typeof parsed.version === 'string' ? parsed.version : '0.0.0';
