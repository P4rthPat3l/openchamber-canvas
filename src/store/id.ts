const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeBytes(bytes: Uint8Array, length: number): string {
  const out: string[] = [];
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out.push(ALPHABET[(buffer >>> (bits - 5)) & 31] ?? '0');
      bits -= 5;
    }
  }
  if (bits > 0) {
    out.push(ALPHABET[(buffer << (5 - bits)) & 31] ?? '0');
  }
  return out.join('').slice(0, length).padEnd(length, '0');
}

function encodeTime(milliseconds: number): string {
  const bytes = new Uint8Array(6);
  let value = milliseconds;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return encodeBytes(bytes, 10);
}

export function slugify(title: string, maxLength = 40): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'artifact';
}

export function newArtifactId(title: string, now: number, random: Uint8Array): string {
  const time = encodeTime(now);
  const suffix = encodeBytes(random.slice(0, 10), 16);
  return `${time}${suffix}-${slugify(title)}`;
}

export function formatVersionId(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '');
}

export function parseVersionId(version: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(version);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.length !== 7 || parts.some((part) => !Number.isFinite(part))) return null;
  const [year, month, day, hour, minute, second, millisecond] = parts as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const value = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  return Number.isNaN(value) ? null : value;
}

export function newVersionId(now: Date, lastVersion?: string): string {
  let milliseconds = now.getTime();
  if (lastVersion !== undefined) {
    const last = parseVersionId(lastVersion);
    if (last !== null && milliseconds <= last) {
      milliseconds = last + 1;
    }
  }
  return formatVersionId(new Date(milliseconds));
}
