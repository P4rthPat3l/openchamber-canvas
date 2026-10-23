import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Whether the Canvas MCP server is registered in an OpenCode config layer.
 *
 * OpenChamber's Settings → MCP writes `mcp.servers` entries into the
 * user-layer OpenCode config (`OPENCODE_CONFIG_DIR` or `$XDG_CONFIG_HOME/opencode`
 * or `~/.config/opencode`), while older hand-written configs keep entries
 * directly under `mcp`. Project-scope registrations are out of reach: the
 * service cannot attribute the panel's project, so this check covers the
 * user layer only.
 */

const MAX_CONFIG_BYTES = 512 * 1024;

export interface McpRegistration {
  /** False when no OpenCode config could be read or parsed; the UI must not nag on uncertainty. */
  checked: boolean;
  registered: boolean;
  name: string | null;
  disabled: boolean;
  commandMatch: boolean;
  source: string | null;
}

export interface McpConfigEntry {
  name: string;
  type: unknown;
  command: unknown;
  disabled: boolean;
}

export const UNCHECKED_REGISTRATION: McpRegistration = {
  checked: false,
  registered: false,
  name: null,
  disabled: false,
  commandMatch: false,
  source: null,
};

/** Mirrors OpenChamber's server config resolution: `OPENCODE_CONFIG`, then the user dir's json/jsonc. */
export function defaultMcpConfigCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates: string[] = [];
  const custom = env['OPENCODE_CONFIG']?.trim();
  if (custom !== undefined && custom.length > 0) candidates.push(path.resolve(custom));
  const overrideDir = env['OPENCODE_CONFIG_DIR']?.trim();
  const xdgDir = env['XDG_CONFIG_HOME']?.trim();
  const dir = overrideDir !== undefined && overrideDir.length > 0
    ? overrideDir
    : xdgDir !== undefined && xdgDir.length > 0
      ? path.join(xdgDir, 'opencode')
      : path.join(os.homedir(), '.config', 'opencode');
  candidates.push(path.join(dir, 'opencode.json'), path.join(dir, 'opencode.jsonc'));
  return candidates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripJsonComments(text: string): string {
  let out = '';
  let index = 0;
  let inString = false;
  while (index < text.length) {
    const char = text[index];
    if (char === undefined) break;
    if (inString) {
      if (char === '\\') {
        out += char + (text[index + 1] ?? '');
        index += 2;
        continue;
      }
      if (char === '"') inString = false;
      out += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && text[index + 1] === '/') {
      const end = text.indexOf('\n', index);
      index = end === -1 ? text.length : end;
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function parseConfig(raw: string): Record<string, unknown> | null {
  const text = stripJsonComments(raw).replace(/^\uFEFF/, '').replace(/,(\s*[}\]])/g, '$1');
  const attempts = [
    () => JSON.parse(text),
    // Hand-edited files can carry raw control characters inside strings.
    () => JSON.parse(text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, ' ')),
  ];
  for (const attempt of attempts) {
    try {
      const parsed = attempt();
      return isRecord(parsed) ? parsed : null;
    } catch {
      // Try the next tolerance level.
    }
  }
  return null;
}

async function readEntries(file: string): Promise<McpConfigEntry[] | null> {
  let raw: string;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) return null;
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return null; // Missing layer: OpenCode may not create the file until the first write.
  }
  const config = parseConfig(raw);
  if (config === null) throw new Error(`Unparseable OpenCode config at ${file}`);
  const entries: McpConfigEntry[] = [];
  const mcp = isRecord(config['mcp']) ? config['mcp'] : null;
  if (mcp === null) return entries;
  const servers = isRecord(mcp['servers']) ? mcp['servers'] : null;
  if (servers !== null) {
    for (const [name, value] of Object.entries(servers)) {
      if (!isRecord(value)) continue;
      entries.push({ name, type: value['type'], command: value['command'], disabled: value['disabled'] === true });
    }
  }
  for (const [name, value] of Object.entries(mcp)) {
    // v1 kept servers directly under `mcp`; v2 uses `mcp.servers`.
    if (name === 'servers' || name === 'timeout' || !isRecord(value) || servers?.[name] !== undefined) continue;
    entries.push({ name, type: value['type'], command: value['command'], disabled: value['disabled'] === true || value['enabled'] === false });
  }
  return entries;
}

function commandPointsAtEntry(entry: McpConfigEntry, mcpPath: string): boolean {
  if (entry.type !== 'local' || !Array.isArray(entry.command)) return false;
  const last = entry.command[entry.command.length - 1];
  if (typeof last !== 'string' || last.length === 0) return false;
  const commandPath = last.startsWith('~/') ? path.join(os.homedir(), last.slice(2)) : last;
  return commandPath === mcpPath;
}

export async function inspectMcpRegistration(
  candidates: readonly string[],
  mcpPath: string,
): Promise<McpRegistration> {
  let sawConfig = false;
  for (const file of candidates) {
    let entries: McpConfigEntry[] | null;
    try {
      entries = await readEntries(file);
    } catch (error) {
      console.error('[canvas service]', error instanceof Error ? error.message : error);
      return { ...UNCHECKED_REGISTRATION };
    }
    if (entries === null) continue;
    sawConfig = true;
    const byPath = entries.find((entry) => commandPointsAtEntry(entry, mcpPath));
    if (byPath !== undefined) {
      return { checked: true, registered: true, name: byPath.name, disabled: byPath.disabled, commandMatch: true, source: file };
    }
    const byName = entries.find((entry) => entry.name === 'canvas');
    if (byName !== undefined) {
      return { checked: true, registered: false, name: byName.name, disabled: byName.disabled, commandMatch: false, source: file };
    }
  }
  return sawConfig
    ? { checked: true, registered: false, name: null, disabled: false, commandMatch: false, source: null }
    : { ...UNCHECKED_REGISTRATION };
}
