// src/service/main.ts
import * as path8 from "node:path";
import { fileURLToPath } from "node:url";

// src/store/index.ts
import * as fs4 from "node:fs/promises";
import * as path5 from "node:path";
import { TextDecoder as TextDecoder2 } from "node:util";

// src/store/errors.ts
class StoreError extends Error {
  code;
  details;
  constructor(code, message, details) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.details = details;
  }
}
function isStoreError(error, code) {
  return error instanceof StoreError && (code === undefined || error.code === code);
}

// src/store/fs.ts
import * as crypto from "node:crypto";
import * as fs2 from "node:fs/promises";
import * as path2 from "node:path";

// src/store/paths.ts
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
var ARTIFACT_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
var VERSION_ID_RE = /^\d{8}T\d{9}Z$/;
var MAX_PATH_LENGTH = 512;
var MAX_SEGMENTS = 8;
var MAX_SEGMENT_LENGTH = 64;
var SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
var WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
function assertArtifactId(id) {
  if (typeof id !== "string" || id.length === 0 || id.length > 80 || !ARTIFACT_ID_RE.test(id)) {
    throw new StoreError("INVALID_PATH", "Invalid artifact id");
  }
}
function assertVersionId(version) {
  if (typeof version !== "string" || !VERSION_ID_RE.test(version)) {
    throw new StoreError("INVALID_PATH", "Invalid version id");
  }
}
function assertRelativePath(input) {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_PATH_LENGTH) {
    throw new StoreError("INVALID_PATH", "Invalid file path");
  }
  if (input.includes("\x00") || input.includes("\\") || input.startsWith("/")) {
    throw new StoreError("INVALID_PATH", "Invalid file path");
  }
  const segments = input.split("/");
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) {
    throw new StoreError("INVALID_PATH", "Invalid file path");
  }
  for (const segment of segments) {
    if (segment.length === 0 || segment.length > MAX_SEGMENT_LENGTH || segment === "." || segment === ".." || !SEGMENT_RE.test(segment) || WINDOWS_RESERVED.test(segment) || segment.endsWith(".") || segment.endsWith(" ")) {
      throw new StoreError("INVALID_PATH", "Invalid file path");
    }
  }
}
function isSafeRelativePath(input) {
  try {
    assertRelativePath(input);
    return true;
  } catch {
    return false;
  }
}
function errorCode(error) {
  if (typeof error !== "object" || error === null || !("code" in error))
    return;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}
function isWithin(parent, child) {
  const relative2 = path.relative(parent, child);
  return relative2 === "" || !relative2.startsWith("..") && !path.isAbsolute(relative2);
}
function normalizeDirectory(input, cwd = process.cwd()) {
  if (typeof input !== "string" || input.trim().length === 0 || input.length > 4096 || input.includes("\x00")) {
    throw new StoreError("INVALID_PATH", "Invalid directory");
  }
  const resolved = path.resolve(cwd, input);
  const parsed = path.parse(resolved);
  return resolved === parsed.root ? resolved : resolved.replace(/[\\/]+$/, "");
}
function projectNameFromDirectory(directory) {
  const base = path.basename(directory);
  if (base.length === 0 || base === "." || base === path.sep)
    return "Uncategorized";
  return base.slice(0, 80);
}
function defaultStoreRoot(env = process.env, home = os.homedir()) {
  const configured = env.CANVAS_STORE?.trim();
  if (configured)
    return path.resolve(configured);
  return path.join(home, ".config", "openchamber", "artifacts");
}
function defaultViewerPortFile(root) {
  return path.join(root, ".viewer.json");
}
function resolveWithin(root, relativePath) {
  assertRelativePath(relativePath);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!isWithin(root, resolved)) {
    throw new StoreError("INVALID_PATH", "Path escapes the allowed root");
  }
  return resolved;
}
function resolveArtifactDir(root, id) {
  assertArtifactId(id);
  const resolved = path.resolve(root, id);
  if (!isWithin(root, resolved)) {
    throw new StoreError("INVALID_PATH", "Artifact path escapes the store");
  }
  return resolved;
}
function resolveVersionDir(root, id, version) {
  assertVersionId(version);
  const artifactDir = resolveArtifactDir(root, id);
  const resolved = path.resolve(artifactDir, "versions", version);
  if (!isWithin(artifactDir, resolved)) {
    throw new StoreError("INVALID_PATH", "Version path escapes the artifact");
  }
  return resolved;
}
async function assertRealpathWithin(root, target) {
  const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
  if (!isWithin(realRoot, realTarget)) {
    throw new StoreError("INVALID_PATH", "Path escapes the allowed root");
  }
  return realTarget;
}

// src/store/fs.ts
var MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".wasm", "application/wasm"],
  [".pdf", "application/pdf"]
]);
function mimeForPath(filePath) {
  return MIME_TYPES.get(path2.extname(filePath).toLowerCase());
}
function isTextMime(mime) {
  const base = mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return base.startsWith("text/") || base === "application/json" || base === "application/javascript";
}
function toBytes(content) {
  return typeof content === "string" ? Buffer.from(content, "utf8") : content;
}
function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}
async function ensureDir(directory) {
  await fs2.mkdir(directory, { recursive: true, mode: 448 });
}
async function pathExists(target) {
  try {
    await fs2.access(target);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      return false;
    throw error;
  }
}
async function writeFileDurable(filePath, data, mode = 384) {
  await ensureDir(path2.dirname(filePath));
  const handle = await fs2.open(filePath, "w", mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function writeJsonDurable(filePath, value) {
  await writeFileDurable(filePath, `${JSON.stringify(value, null, 2)}
`);
}
async function renameWithRetry(from, to, attempts = 5) {
  for (let attempt = 1;attempt <= attempts; attempt += 1) {
    try {
      await fs2.rename(from, to);
      return;
    } catch (error) {
      const code = errorCode(error);
      if ((code === "EPERM" || code === "EBUSY" || code === "EACCES") && attempt < attempts) {
        await sleep(20 * attempt);
        continue;
      }
      throw error;
    }
  }
}
async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp-${randomHex(6)}`;
  try {
    await writeJsonDurable(temporary, value);
    await renameWithRetry(temporary, filePath);
  } catch (error) {
    await fs2.rm(temporary, { force: true });
    throw error;
  }
}
async function readJson(filePath) {
  const text = await fs2.readFile(filePath, "utf8");
  try {
    const parsed = JSON.parse(text);
    return parsed;
  } catch {
    throw new StoreError("INVALID_META", `${path2.basename(filePath)} is not valid JSON`);
  }
}
function sleep(milliseconds) {
  return new Promise((resolve2) => setTimeout(resolve2, milliseconds));
}

// src/store/id.ts
var ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function encodeBytes(bytes, length) {
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = buffer << 8 | byte;
    bits += 8;
    while (bits >= 5) {
      out.push(ALPHABET[buffer >>> bits - 5 & 31] ?? "0");
      bits -= 5;
    }
  }
  if (bits > 0) {
    out.push(ALPHABET[buffer << 5 - bits & 31] ?? "0");
  }
  return out.join("").slice(0, length).padEnd(length, "0");
}
function encodeTime(milliseconds) {
  const bytes = new Uint8Array(6);
  let value = milliseconds;
  for (let index = 5;index >= 0; index -= 1) {
    bytes[index] = value & 255;
    value = Math.floor(value / 256);
  }
  return encodeBytes(bytes, 10);
}
function slugify(title, maxLength = 40) {
  const slug = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, maxLength).replace(/-+$/g, "");
  return slug.length > 0 ? slug : "artifact";
}
function newArtifactId(title, now, random) {
  const time = encodeTime(now);
  const suffix = encodeBytes(random.slice(0, 10), 16);
  return `${time}${suffix}-${slugify(title)}`;
}
function formatVersionId(date) {
  return date.toISOString().replace(/[-:.]/g, "");
}
function parseVersionId(version) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(version);
  if (!match)
    return null;
  const parts = match.slice(1).map(Number);
  if (parts.length !== 7 || parts.some((part) => !Number.isFinite(part)))
    return null;
  const [year, month, day, hour, minute, second, millisecond] = parts;
  const value = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  return Number.isNaN(value) ? null : value;
}
function newVersionId(now, lastVersion) {
  let milliseconds = now.getTime();
  if (lastVersion !== undefined) {
    const last = parseVersionId(lastVersion);
    if (last !== null && milliseconds <= last) {
      milliseconds = last + 1;
    }
  }
  return formatVersionId(new Date(milliseconds));
}

// src/store/lock.ts
import * as fs3 from "node:fs/promises";
import * as path3 from "node:path";
async function removeStaleLock(lockDir, staleMs) {
  try {
    const stats = await fs3.stat(lockDir);
    if (Date.now() - stats.mtimeMs > staleMs) {
      await fs3.rm(lockDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT")
      throw error;
  }
}
async function withArtifactLock(lockDir, action, options) {
  await ensureDir(path3.dirname(lockDir));
  const startedAt = Date.now();
  for (;; ) {
    try {
      await fs3.mkdir(lockDir, { mode: 448 });
      const owner = { pid: process.pid, at: new Date().toISOString() };
      try {
        await writeFileDurable(path3.join(lockDir, "owner.json"), `${JSON.stringify(owner)}
`);
      } catch (error) {
        await fs3.rm(lockDir, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (errorCode(error) !== "EEXIST")
        throw error;
      await removeStaleLock(lockDir, options.staleMs);
      if (Date.now() - startedAt >= options.timeoutMs) {
        throw new StoreError("LOCK_TIMEOUT", "Another writer held the artifact lock too long");
      }
      await sleep(options.retryMs);
    }
  }
  try {
    return await action();
  } finally {
    await fs3.rm(lockDir, { recursive: true, force: true });
  }
}

// src/store/schema.ts
import * as path4 from "node:path";
var KINDS = ["html", "bundle", "markdown", "image", "pdf", "data"];
var LIVE_FORMATS = ["csv", "json", "text"];
var LIVE_SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
var LIBRARY_NAME_RE = /^[a-z0-9-]{1,32}$/;
var FEEDBACK_ID_RE = /^fb_[a-f0-9]{24}$/;
var FEEDBACK_MAX_BYTES = 64 * 1024;
var STATE_MAX_BYTES = 1024 * 1024;
var SHA256_RE = /^[a-f0-9]{64}$/;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function fail(message) {
  throw new StoreError("INVALID_META", message);
}
function isIsoDate(value) {
  return typeof value === "string" && value.includes("T") && !Number.isNaN(Date.parse(value));
}
function isKind(value) {
  return typeof value === "string" && KINDS.includes(value);
}
function isJsonValue(value, depth = 0) {
  if (depth > 20)
    return false;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number")
    return Number.isFinite(value);
  if (Array.isArray(value))
    return value.every((entry) => isJsonValue(entry, depth + 1));
  if (isRecord(value))
    return Object.values(value).every((entry) => isJsonValue(entry, depth + 1));
  return false;
}
function jsonByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
}
function requireString(record, key, maxLength) {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    fail(`${key} must be a string of 1 to ${maxLength} characters`);
  }
  return value;
}
function requireInteger(record, key, minimum, maximum) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${key} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}
function requireBoolean(record, key) {
  const value = record[key];
  if (typeof value !== "boolean")
    fail(`${key} must be a boolean`);
  return value;
}
function nullableString(record, key, maxLength) {
  const value = record[key];
  if (value === null)
    return null;
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    fail(`${key} must be null or a string of 1 to ${maxLength} characters`);
  }
  return value;
}
function parseStringArray(value, key, maximum, maxLength) {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(`${key} must be an array of at most ${maximum} entries`);
  }
  const result = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > maxLength) {
      fail(`${key} entries must be strings of 1 to ${maxLength} characters`);
    }
    result.push(entry);
  }
  return result;
}
function parseVersionSummary(value) {
  if (!isRecord(value))
    fail("version entry must be an object");
  const id = requireString(value, "id", 40);
  if (!VERSION_ID_RE.test(id))
    fail("version id is invalid");
  const createdAt = requireString(value, "createdAt", 40);
  if (!isIsoDate(createdAt))
    fail("version createdAt is invalid");
  const bytes = requireInteger(value, "bytes", 0, 100 * 1024 * 1024);
  const files = requireInteger(value, "files", 1, 1e4);
  const title = requireString(value, "title", 200);
  const restoredFrom = nullableString(value, "restoredFrom", 40);
  if (restoredFrom !== null && !VERSION_ID_RE.test(restoredFrom))
    fail("restoredFrom is invalid");
  return { id, createdAt, bytes, files, title, restoredFrom };
}
function parseFileRecord(value) {
  if (!isRecord(value))
    fail("file entry must be an object");
  const filePath = requireString(value, "path", 512);
  if (!isSafeRelativePath(filePath))
    fail("file path is invalid");
  const bytes = requireInteger(value, "bytes", 0, 100 * 1024 * 1024);
  const hash = requireString(value, "sha256", 64);
  if (!SHA256_RE.test(hash))
    fail("file sha256 is invalid");
  const mime = requireString(value, "mime", 128);
  return { path: filePath, bytes, sha256: hash, mime };
}
function parseLiveSource(value) {
  if (!isRecord(value))
    fail("live source must be an object");
  const id = requireString(value, "id", 32);
  if (!LIVE_SOURCE_ID_RE.test(id))
    fail("live source id is invalid");
  const kind = requireString(value, "kind", 16);
  if (kind !== "file")
    fail("live source kind must be file");
  const sourcePath = requireString(value, "path", 512);
  if (!isSafeRelativePath(sourcePath))
    fail("live source path is invalid");
  const format = requireString(value, "format", 16);
  if (!LIVE_FORMATS.includes(format))
    fail("live source format is invalid");
  const refresh = requireString(value, "refresh", 16);
  if (refresh !== "open")
    fail("live source refresh must be open");
  const maxBytes = requireInteger(value, "maxBytes", 1, 10 * 1024 * 1024);
  return {
    id,
    kind: "file",
    path: sourcePath,
    format,
    refresh: "open",
    maxBytes
  };
}
function parseVersionManifest(value) {
  if (!isRecord(value))
    fail("version manifest must be an object");
  if (value.schema !== 1)
    fail("version manifest schema must be 1");
  if (!isKind(value.kind))
    fail("version manifest kind is invalid");
  const entry = requireString(value, "entry", 512);
  if (!isSafeRelativePath(entry))
    fail("version manifest entry is invalid");
  const title = requireString(value, "title", 200);
  const createdAt = requireString(value, "createdAt", 40);
  if (!isIsoDate(createdAt))
    fail("version manifest createdAt is invalid");
  const restoredFrom = nullableString(value, "restoredFrom", 40);
  if (restoredFrom !== null && !VERSION_ID_RE.test(restoredFrom)) {
    fail("version manifest restoredFrom is invalid");
  }
  const rawFiles = value.files;
  if (!Array.isArray(rawFiles) || rawFiles.length === 0 || rawFiles.length > 200) {
    fail("version manifest files must contain 1 to 200 entries");
  }
  const files = rawFiles.map(parseFileRecord);
  const seen = new Set;
  for (const file of files) {
    if (seen.has(file.path))
      fail("version manifest has duplicate file paths");
    seen.add(file.path);
  }
  if (!seen.has(entry))
    fail("version manifest entry is not in files");
  if (value.kind === "html" && files.length !== 1) {
    fail("an html version must have exactly one file");
  }
  return {
    schema: 1,
    kind: value.kind,
    entry,
    title,
    createdAt,
    restoredFrom,
    files
  };
}
function parseMeta(value) {
  if (!isRecord(value))
    fail("meta must be an object");
  if (value.schema !== 2)
    fail("meta schema must be 2");
  const id = requireString(value, "id", 80);
  if (!ARTIFACT_ID_RE.test(id))
    fail("meta id is invalid");
  const title = requireString(value, "title", 200);
  if (!isKind(value.kind))
    fail("meta kind is invalid");
  const directory = requireString(value, "directory", 4096);
  if (!path4.isAbsolute(directory))
    fail("meta directory must be absolute");
  const projectName = requireString(value, "projectName", 80);
  const sessionId = nullableString(value, "sessionId", 200);
  const tags = parseStringArray(value.tags, "tags", 16, 32);
  const favorite = requireBoolean(value, "favorite");
  const createdAt = requireString(value, "createdAt", 40);
  if (!isIsoDate(createdAt))
    fail("meta createdAt is invalid");
  const updatedAt = requireString(value, "updatedAt", 40);
  if (!isIsoDate(updatedAt))
    fail("meta updatedAt is invalid");
  const archivedAt = nullableString(value, "archivedAt", 40);
  if (archivedAt !== null && !isIsoDate(archivedAt))
    fail("meta archivedAt is invalid");
  const lastOpenedAt = nullableString(value, "lastOpenedAt", 40);
  if (lastOpenedAt !== null && !isIsoDate(lastOpenedAt))
    fail("meta lastOpenedAt is invalid");
  const currentVersion = requireString(value, "currentVersion", 40);
  if (!VERSION_ID_RE.test(currentVersion))
    fail("meta currentVersion is invalid");
  const pinnedVersion = nullableString(value, "pinnedVersion", 40);
  if (pinnedVersion !== null && !VERSION_ID_RE.test(pinnedVersion)) {
    fail("meta pinnedVersion is invalid");
  }
  const librarySet = requireString(value, "librarySet", 64);
  const rawLibraries = value.libraries;
  let libraries = [];
  if (rawLibraries !== undefined) {
    if (!Array.isArray(rawLibraries) || rawLibraries.length > 16) {
      fail("meta libraries must contain at most 16 entries");
    }
    const seen = new Set;
    for (const name of rawLibraries) {
      if (typeof name !== "string" || !LIBRARY_NAME_RE.test(name)) {
        fail("meta library names are invalid");
      }
      seen.add(name);
    }
    libraries = [...seen];
  }
  const openCount = requireInteger(value, "openCount", 0, 1e6);
  const dedupeKey = nullableString(value, "dedupeKey", 200);
  const rawVersions = value.versions;
  if (!Array.isArray(rawVersions) || rawVersions.length === 0 || rawVersions.length > 1e4) {
    fail("meta versions must contain 1 to 10000 entries");
  }
  const versions = rawVersions.map(parseVersionSummary);
  if (!versions.some((version) => version.id === currentVersion)) {
    fail("meta currentVersion is not in versions");
  }
  if (pinnedVersion !== null && !versions.some((version) => version.id === pinnedVersion)) {
    fail("meta pinnedVersion is not in versions");
  }
  const rawLive = value.live;
  if (!Array.isArray(rawLive) || rawLive.length > 8) {
    fail("meta live must contain at most 8 entries");
  }
  const live = rawLive.map(parseLiveSource);
  return {
    schema: 2,
    id,
    title,
    kind: value.kind,
    directory,
    projectName,
    sessionId,
    tags,
    favorite,
    createdAt,
    updatedAt,
    archivedAt,
    currentVersion,
    pinnedVersion,
    librarySet,
    libraries,
    versions,
    live,
    openCount,
    lastOpenedAt,
    dedupeKey
  };
}
function parseFeedbackRecord(value) {
  if (!isRecord(value))
    fail("feedback record must be an object");
  if (value.schema !== 1)
    fail("feedback schema must be 1");
  const id = requireString(value, "id", 27);
  if (!FEEDBACK_ID_RE.test(id))
    fail("feedback id is invalid");
  const artifactId = requireString(value, "artifactId", 80);
  if (!ARTIFACT_ID_RE.test(artifactId))
    fail("feedback artifactId is invalid");
  const version = requireString(value, "version", 40);
  if (!VERSION_ID_RE.test(version))
    fail("feedback version is invalid");
  const createdAt = requireString(value, "createdAt", 40);
  if (!isIsoDate(createdAt))
    fail("feedback createdAt is invalid");
  const kind = requireString(value, "kind", 64);
  const data = value.data;
  if (!isJsonValue(data))
    fail("feedback data must be JSON");
  if (jsonByteLength(data) > FEEDBACK_MAX_BYTES)
    fail("feedback data is too large");
  const deliveredAt = nullableString(value, "deliveredAt", 40);
  if (deliveredAt !== null && !isIsoDate(deliveredAt))
    fail("feedback deliveredAt is invalid");
  return { schema: 1, id, artifactId, version, createdAt, kind, data, deliveredAt };
}
function parseRuntimeState(value) {
  if (!isRecord(value))
    fail("runtime state must be an object");
  const state = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0 || key.length > 128) {
      fail("runtime state keys must be 1 to 128 characters");
    }
    if (!isJsonValue(entry))
      fail("runtime state values must be JSON");
    state[key] = entry;
  }
  if (Buffer.byteLength(JSON.stringify(state) ?? "{}", "utf8") > STATE_MAX_BYTES) {
    fail("runtime state is too large");
  }
  return state;
}

// src/store/index.ts
var LIVE_SOURCE_ID_RE2 = /^[a-z][a-z0-9-]{0,31}$/;
var LIBRARY_NAME_RE2 = /^[a-z0-9-]{1,32}$/;
var FEEDBACK_ID_RE2 = /^fb_[a-f0-9]{24}$/;

class ArtifactStore {
  root;
  trashRoot;
  locksRoot;
  now;
  random;
  lockRetryMs;
  lockTimeoutMs;
  lockStaleMs;
  versionsKept;
  maxHtmlBytes;
  maxBundleBytes;
  maxBundleFiles;
  maxFileBytes;
  initPromise = null;
  constructor(options) {
    this.root = path5.resolve(options.root);
    this.trashRoot = path5.join(this.root, "trash");
    this.locksRoot = path5.join(this.root, ".locks");
    this.now = options.now ?? (() => new Date);
    this.random = options.random ?? ((size) => new Uint8Array(randomBytes2(size)));
    this.lockRetryMs = options.lockRetryMs ?? 50;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5000;
    this.lockStaleMs = options.lockStaleMs ?? 30000;
    this.versionsKept = options.versionsKept ?? 30;
    this.maxHtmlBytes = options.maxHtmlBytes ?? 2 * 1024 * 1024;
    this.maxBundleBytes = options.maxBundleBytes ?? 20 * 1024 * 1024;
    this.maxBundleFiles = options.maxBundleFiles ?? 200;
    this.maxFileBytes = options.maxFileBytes ?? 5 * 1024 * 1024;
  }
  static default(overrides = {}) {
    return new ArtifactStore({ ...overrides, root: overrides.root ?? defaultStoreRoot() });
  }
  get storeRoot() {
    return this.root;
  }
  async init() {
    await ensureDir(this.root);
    await ensureDir(this.trashRoot);
    await ensureDir(this.locksRoot);
  }
  async create(input) {
    await this.ensureInit();
    const now = input.now ?? this.now();
    const title = normalizeTitle(input.title);
    const directory = normalizeDirectory(input.directory);
    const tags = normalizeTags(input.tags);
    const kind = input.kind;
    if (kind !== "html" && kind !== "bundle") {
      throw new StoreError("UNSUPPORTED_KIND", `${kind} artifacts are not implemented yet`);
    }
    const files = normalizeFiles(input.files);
    const entry = resolveEntry(kind, files, input.entry);
    validateFileSet(kind, files, entry, this.limits());
    const dedupeKey = normalizeOptional(input.dedupeKey, 200);
    if (dedupeKey !== null) {
      const existing = await this.findByDedupeKey(dedupeKey, directory);
      if (existing !== null)
        return existing;
    }
    const { id, artifactDir } = await this.allocateArtifact(title, now);
    try {
      const version = await this.writeVersion({
        artifactDir,
        kind,
        title,
        entry,
        files,
        now,
        restoredFrom: null,
        existingVersions: []
      });
      const summary = summarizeVersion(version.id, version.manifest, version.totalBytes);
      const meta = {
        schema: 2,
        id,
        title,
        kind,
        directory,
        projectName: projectNameFromDirectory(directory),
        sessionId: normalizeOptional(input.sessionId, 200),
        tags,
        favorite: false,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        archivedAt: null,
        currentVersion: version.id,
        pinnedVersion: null,
        librarySet: normalizeLibrarySet(input.librarySet),
        libraries: normalizeLibraries(input.libraries),
        versions: [summary],
        live: normalizeLiveSources(input.live),
        openCount: 0,
        lastOpenedAt: null,
        dedupeKey
      };
      await writeJsonAtomic(path5.join(artifactDir, "meta.json"), meta);
      return { id, version: version.id, meta, deduped: false };
    } catch (error) {
      await fs4.rm(artifactDir, { recursive: true, force: true });
      throw error;
    }
  }
  async update(id, input) {
    await this.ensureInit();
    assertArtifactId(id);
    const artifactDir = resolveArtifactDir(this.root, id);
    const lockDir = this.lockPath(id);
    return withArtifactLock(lockDir, async () => {
      const meta = await this.getMeta(id);
      this.assertBaseVersion(meta, input.baseVersion, input.mode);
      const now = this.now();
      const plan = await this.planUpdate(id, meta, input);
      const version = await this.writeVersion({
        artifactDir,
        kind: plan.kind,
        title: plan.title,
        entry: plan.entry,
        files: plan.files,
        now,
        restoredFrom: plan.restoredFrom,
        existingVersions: meta.versions.map((entry) => entry.id)
      });
      const summary = summarizeVersion(version.id, version.manifest, version.totalBytes);
      const nextMeta = {
        ...meta,
        title: plan.title,
        tags: plan.tags,
        updatedAt: now.toISOString(),
        currentVersion: version.id,
        versions: [...meta.versions, summary]
      };
      const pruned = this.pruneMeta(nextMeta);
      try {
        await writeJsonAtomic(path5.join(artifactDir, "meta.json"), pruned.meta);
      } catch (error) {
        await fs4.rm(path5.join(artifactDir, "versions", version.id), { recursive: true, force: true });
        throw error;
      }
      for (const prunedVersion of pruned.removed) {
        const versionDir = resolveVersionDir(this.root, id, prunedVersion);
        await fs4.rm(versionDir, { recursive: true, force: true }).catch(() => {
          return;
        });
      }
      return { id, version: version.id, changedFiles: plan.changedFiles, meta: pruned.meta };
    }, this.lockOptions());
  }
  async read(id, version) {
    const meta = await this.getMeta(id);
    const versionId = version ?? meta.currentVersion;
    assertVersionId(versionId);
    if (!meta.versions.some((entry) => entry.id === versionId)) {
      throw new StoreError("NOT_FOUND", "Version not found");
    }
    const manifest = await this.readManifest(id, versionId);
    return { meta, version: versionId, manifest };
  }
  async readVersion(id, version) {
    const result = await this.read(id, version);
    const versionDir = resolveVersionDir(this.root, id, result.version);
    const files = await Promise.all(result.manifest.files.map(async (file) => ({
      ...file,
      content: await this.readFileAt(versionDir, file.path)
    })));
    return { ...result, files };
  }
  async readFile(id, version, filePath) {
    const result = await this.read(id, version);
    const record = result.manifest.files.find((file) => file.path === filePath);
    if (record === undefined) {
      throw new StoreError("PATH_NOT_FOUND", "File not found in this version");
    }
    const versionDir = resolveVersionDir(this.root, id, result.version);
    return this.readFileAt(versionDir, record.path);
  }
  async getMeta(id) {
    await this.ensureInit();
    assertArtifactId(id);
    const artifactDir = resolveArtifactDir(this.root, id);
    try {
      const raw = await readJson(path5.join(artifactDir, "meta.json"));
      const meta = parseMeta(raw);
      if (meta.id !== id) {
        throw new StoreError("INVALID_META", "meta.id does not match the directory");
      }
      return meta;
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        throw new StoreError("NOT_FOUND", "Artifact not found");
      }
      throw error;
    }
  }
  async getVersions(id) {
    const meta = await this.getMeta(id);
    return meta.versions;
  }
  async list(filter = {}) {
    await this.ensureInit();
    const directory = filter.directory === undefined ? undefined : normalizeDirectory(filter.directory);
    const tag = filter.tag?.toLowerCase();
    const query = filter.query?.toLowerCase();
    const entries = await fs4.readdir(this.root, { withFileTypes: true });
    const artifacts = [];
    let errors = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "trash")
        continue;
      let meta;
      try {
        const raw = await readJson(path5.join(this.root, entry.name, "meta.json"));
        meta = parseMeta(raw);
      } catch {
        errors += 1;
        continue;
      }
      if (meta.id !== entry.name) {
        errors += 1;
        continue;
      }
      if (filter.includeArchived !== true && meta.archivedAt !== null)
        continue;
      if (directory !== undefined && !isWithin(directory, meta.directory))
        continue;
      if (filter.kind !== undefined && meta.kind !== filter.kind)
        continue;
      if (tag !== undefined && !meta.tags.some((entryTag) => entryTag.toLowerCase() === tag))
        continue;
      if (query !== undefined) {
        const matchesTitle = meta.title.toLowerCase().includes(query);
        const matchesTag = meta.tags.some((entryTag) => entryTag.toLowerCase().includes(query));
        if (!matchesTitle && !matchesTag)
          continue;
      }
      artifacts.push({
        id: meta.id,
        title: meta.title,
        kind: meta.kind,
        directory: meta.directory,
        projectName: meta.projectName,
        updatedAt: meta.updatedAt,
        versions: meta.versions.length,
        currentVersion: meta.currentVersion,
        tags: meta.tags,
        favorite: meta.favorite,
        archived: meta.archivedAt !== null,
        feedbackCount: await this.countFeedback(meta.id)
      });
    }
    artifacts.sort((left, right) => {
      const updated = right.updatedAt.localeCompare(left.updatedAt);
      return updated !== 0 ? updated : left.id.localeCompare(right.id);
    });
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    return { artifacts: artifacts.slice(0, limit), errors };
  }
  async listTrash() {
    await this.ensureInit();
    let entries;
    try {
      entries = await fs4.readdir(this.trashRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    const artifacts = [];
    for (const entry of entries) {
      if (!entry.isDirectory())
        continue;
      try {
        const raw = await readJson(path5.join(this.trashRoot, entry.name, "meta.json"));
        const meta = parseMeta(raw);
        artifacts.push({
          id: meta.id,
          title: meta.title,
          kind: meta.kind,
          directory: meta.directory,
          projectName: meta.projectName,
          updatedAt: meta.updatedAt,
          versions: meta.versions.length,
          currentVersion: meta.currentVersion,
          tags: meta.tags,
          favorite: meta.favorite,
          archived: meta.archivedAt !== null,
          feedbackCount: 0
        });
      } catch {
        continue;
      }
    }
    artifacts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return artifacts;
  }
  async archive(id, archived) {
    return this.updateMeta(id, (meta, now) => ({
      ...meta,
      archivedAt: archived ? now.toISOString() : null
    }));
  }
  async setFavorite(id, favorite) {
    return this.updateMeta(id, (meta) => ({ ...meta, favorite }));
  }
  async setPinned(id, version) {
    if (version !== null)
      assertVersionId(version);
    return this.updateMeta(id, (meta) => {
      if (version !== null && !meta.versions.some((entry) => entry.id === version)) {
        throw new StoreError("NOT_FOUND", "Version not found");
      }
      return { ...meta, pinnedVersion: version };
    });
  }
  async trash(id) {
    await this.ensureInit();
    assertArtifactId(id);
    const artifactDir = resolveArtifactDir(this.root, id);
    const lockDir = this.lockPath(id);
    await withArtifactLock(lockDir, async () => {
      await this.getMeta(id);
      const stamp = this.now().getTime();
      let target = path5.join(this.trashRoot, `${id}-${stamp}`);
      for (let attempt = 1;await pathExists(target); attempt += 1) {
        target = path5.join(this.trashRoot, `${id}-${stamp}-${attempt}`);
      }
      await renameWithRetry(artifactDir, target);
    }, this.lockOptions());
  }
  async untrash(id) {
    await this.ensureInit();
    assertArtifactId(id);
    const artifactDir = resolveArtifactDir(this.root, id);
    const lockDir = this.lockPath(id);
    return withArtifactLock(lockDir, async () => {
      if (await pathExists(artifactDir)) {
        throw new StoreError("CONFLICT", "An artifact with this id already exists");
      }
      const entries = await fs4.readdir(this.trashRoot, { withFileTypes: true });
      const candidates = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(`${id}-`)).map((entry) => entry.name).sort().reverse();
      const source = candidates[0];
      if (source === undefined) {
        throw new StoreError("NOT_FOUND", "No trashed artifact found");
      }
      await renameWithRetry(path5.join(this.trashRoot, source), artifactDir);
      return this.getMeta(id);
    }, this.lockOptions());
  }
  async countFeedback(id) {
    try {
      const entries = await fs4.readdir(path5.join(this.root, id, "feedback"), { withFileTypes: true });
      return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).length;
    } catch (error) {
      if (errorCode(error) === "ENOENT")
        return 0;
      throw error;
    }
  }
  async addFeedback(id, input) {
    await this.ensureInit();
    assertArtifactId(id);
    assertVersionId(input.version);
    const kind = input.kind ?? "form";
    if (typeof kind !== "string" || kind.length === 0 || kind.length > 64) {
      throw new StoreError("INVALID_ARTIFACT", "Feedback kind must be 1 to 64 characters");
    }
    if (!isJsonValue(input.data)) {
      throw new StoreError("INVALID_ARTIFACT", "Feedback data must be JSON");
    }
    if (jsonByteLength(input.data) > 64 * 1024) {
      throw new StoreError("TOO_LARGE", "Feedback is limited to 64 KiB");
    }
    return withArtifactLock(this.lockPath(id), async () => {
      const meta = await this.getMeta(id);
      if (!meta.versions.some((version) => version.id === input.version)) {
        throw new StoreError("NOT_FOUND", "Version not found");
      }
      const record = {
        schema: 1,
        id: `fb_${randomHex(12)}`,
        artifactId: id,
        version: input.version,
        createdAt: this.now().toISOString(),
        kind,
        data: input.data,
        deliveredAt: null
      };
      const feedbackDir = path5.join(resolveArtifactDir(this.root, id), "feedback");
      await ensureDir(feedbackDir);
      await writeJsonAtomic(path5.join(feedbackDir, `${record.id}.json`), record);
      return record;
    }, this.lockOptions());
  }
  async listFeedback(id, options = {}) {
    await this.ensureInit();
    assertArtifactId(id);
    const feedbackDir = path5.join(resolveArtifactDir(this.root, id), "feedback");
    let entries;
    try {
      entries = await fs4.readdir(feedbackDir, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === "ENOENT")
        return [];
      throw error;
    }
    const records = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json"))
        continue;
      try {
        const raw = await readJson(path5.join(feedbackDir, entry.name));
        const record = parseFeedbackRecord(raw);
        if (record.artifactId !== id)
          continue;
        if (options.since !== undefined && record.createdAt <= options.since)
          continue;
        records.push(record);
      } catch {
        continue;
      }
    }
    records.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    return records.slice(0, limit);
  }
  async markFeedbackDelivered(id, feedbackIds) {
    await this.ensureInit();
    assertArtifactId(id);
    if (!Array.isArray(feedbackIds) || feedbackIds.length === 0)
      return 0;
    return withArtifactLock(this.lockPath(id), async () => {
      await this.getMeta(id);
      const feedbackDir = path5.join(resolveArtifactDir(this.root, id), "feedback");
      const deliveredAt = this.now().toISOString();
      let count = 0;
      for (const feedbackId of feedbackIds) {
        if (typeof feedbackId !== "string" || !FEEDBACK_ID_RE2.test(feedbackId))
          continue;
        const feedbackPath = path5.join(feedbackDir, `${feedbackId}.json`);
        try {
          const raw = await readJson(feedbackPath);
          const record = parseFeedbackRecord(raw);
          if (record.artifactId !== id || record.deliveredAt !== null)
            continue;
          await writeJsonAtomic(feedbackPath, { ...record, deliveredAt });
          count += 1;
        } catch {
          continue;
        }
      }
      return count;
    }, this.lockOptions());
  }
  async readState(id) {
    await this.getMeta(id);
    const statePath = path5.join(resolveArtifactDir(this.root, id), "state.json");
    try {
      const raw = await readJson(statePath);
      return parseRuntimeState(raw);
    } catch (error) {
      if (errorCode(error) === "ENOENT")
        return {};
      throw error;
    }
  }
  async writeStateKey(id, key, value) {
    await this.ensureInit();
    assertArtifactId(id);
    if (typeof key !== "string" || key.length === 0 || key.length > 128 || key.includes("\x00")) {
      throw new StoreError("INVALID_ARTIFACT", "State key must be 1 to 128 characters");
    }
    if (value !== undefined && !isJsonValue(value)) {
      throw new StoreError("INVALID_ARTIFACT", "State value must be JSON");
    }
    return withArtifactLock(this.lockPath(id), async () => {
      await this.getMeta(id);
      const statePath = path5.join(resolveArtifactDir(this.root, id), "state.json");
      let state = {};
      try {
        const raw = await readJson(statePath);
        state = parseRuntimeState(raw);
      } catch (error) {
        if (errorCode(error) !== "ENOENT")
          throw error;
      }
      if (value === undefined) {
        delete state[key];
      } else {
        state[key] = value;
      }
      if (Buffer.byteLength(JSON.stringify(state) ?? "{}", "utf8") > 1024 * 1024) {
        throw new StoreError("TOO_LARGE", "Runtime state is limited to 1 MiB");
      }
      await writeJsonAtomic(statePath, state);
      return state;
    }, this.lockOptions());
  }
  async clearState(id) {
    await this.ensureInit();
    assertArtifactId(id);
    await withArtifactLock(this.lockPath(id), async () => {
      await this.getMeta(id);
      await fs4.rm(path5.join(resolveArtifactDir(this.root, id), "state.json"), { force: true });
    }, this.lockOptions());
  }
  async ensureInit() {
    this.initPromise ??= this.init();
    await this.initPromise;
  }
  lockPath(id) {
    return path5.join(this.locksRoot, `${id}.lock`);
  }
  lockOptions() {
    return {
      retryMs: this.lockRetryMs,
      timeoutMs: this.lockTimeoutMs,
      staleMs: this.lockStaleMs
    };
  }
  limits() {
    return {
      maxHtmlBytes: this.maxHtmlBytes,
      maxBundleBytes: this.maxBundleBytes,
      maxBundleFiles: this.maxBundleFiles,
      maxFileBytes: this.maxFileBytes
    };
  }
  async allocateArtifact(title, now) {
    for (let attempt = 0;attempt < 5; attempt += 1) {
      const id = newArtifactId(title, now.getTime(), this.random(10));
      assertArtifactId(id);
      const artifactDir = resolveArtifactDir(this.root, id);
      try {
        await fs4.mkdir(artifactDir, { mode: 448 });
        return { id, artifactDir };
      } catch (error) {
        if (errorCode(error) === "EEXIST")
          continue;
        throw error;
      }
    }
    throw new StoreError("STORE_UNAVAILABLE", "Could not allocate an artifact id");
  }
  async findByDedupeKey(key, directory) {
    const metas = await this.readAllMetas();
    const found = metas.find((meta) => meta.dedupeKey === key && meta.directory === directory);
    if (found === undefined)
      return null;
    return { id: found.id, version: found.currentVersion, meta: found, deduped: true };
  }
  async readAllMetas() {
    const entries = await fs4.readdir(this.root, { withFileTypes: true });
    const metas = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "trash")
        continue;
      try {
        const raw = await readJson(path5.join(this.root, entry.name, "meta.json"));
        const meta = parseMeta(raw);
        if (meta.id === entry.name)
          metas.push(meta);
      } catch {
        continue;
      }
    }
    return metas;
  }
  assertBaseVersion(meta, baseVersion, mode) {
    const required = mode === "merge" || mode === "edits" || mode === "restore";
    if (baseVersion === undefined) {
      if (required) {
        throw new StoreError("INVALID_UPDATE", `baseVersion is required for ${mode}`);
      }
      return;
    }
    assertVersionId(baseVersion);
    if (baseVersion !== meta.currentVersion) {
      throw new StoreError("CONFLICT", "The artifact has a newer version", {
        currentVersion: meta.currentVersion
      });
    }
  }
  async planUpdate(id, meta, input) {
    const title = input.title === undefined ? meta.title : normalizeTitle(input.title);
    const tags = input.tags === undefined ? meta.tags : normalizeTags(input.tags);
    const kind = meta.kind;
    if (kind !== "html" && kind !== "bundle") {
      throw new StoreError("UNSUPPORTED_KIND", `${kind} artifacts are not implemented yet`);
    }
    switch (input.mode) {
      case "replace": {
        const files = normalizeFiles(input.files);
        const entry = resolveEntry(kind, files, input.entry);
        validateFileSet(kind, files, entry, this.limits());
        return {
          kind,
          title,
          tags,
          entry,
          files,
          restoredFrom: null,
          changedFiles: await this.changedFiles(meta, files)
        };
      }
      case "merge": {
        const current = await this.readVersion(id, meta.currentVersion);
        const merged = new Map;
        for (const file of current.files) {
          merged.set(file.path, { path: file.path, bytes: file.content, mime: file.mime });
        }
        for (const file of normalizeFiles(input.files, true)) {
          merged.set(file.path, file);
        }
        for (const removePath of input.remove ?? []) {
          assertRelativePath(removePath);
          merged.delete(removePath);
        }
        const files = [...merged.values()].sort((left, right) => left.path.localeCompare(right.path));
        let entry = current.manifest.entry;
        if (input.entry !== undefined) {
          assertRelativePath(input.entry);
          entry = input.entry;
        }
        validateFileSet(kind, files, entry, this.limits());
        return {
          kind,
          title,
          tags,
          entry,
          files,
          restoredFrom: null,
          changedFiles: await this.changedFiles(meta, files)
        };
      }
      case "edits": {
        const current = await this.readVersion(id, meta.currentVersion);
        const targetPath = input.path ?? current.manifest.entry;
        assertRelativePath(targetPath);
        const record = current.manifest.files.find((file) => file.path === targetPath);
        if (record === undefined) {
          throw new StoreError("PATH_NOT_FOUND", "File not found in this version");
        }
        if (!isTextMime(record.mime)) {
          throw new StoreError("UNSUPPORTED_FILE_TYPE", "Edits require a text file");
        }
        const target = current.files.find((file) => file.path === targetPath);
        if (target === undefined) {
          throw new StoreError("PATH_NOT_FOUND", "File not found in this version");
        }
        let source;
        try {
          source = new TextDecoder2("utf-8", { fatal: true }).decode(target.content);
        } catch {
          throw new StoreError("INVALID_ARTIFACT", "File is not valid UTF-8");
        }
        const edited = applyEdits(source, input.edits);
        const files = current.files.map((file) => file.path === targetPath ? { path: file.path, bytes: Buffer.from(edited, "utf8"), mime: file.mime } : { path: file.path, bytes: file.content, mime: file.mime });
        validateFileSet(kind, files, current.manifest.entry, this.limits());
        return {
          kind,
          title,
          tags,
          entry: current.manifest.entry,
          files,
          restoredFrom: null,
          changedFiles: await this.changedFiles(meta, files)
        };
      }
      case "restore": {
        const source = await this.readVersion(id, input.restoreFrom);
        const files = source.files.map((file) => ({
          path: file.path,
          bytes: file.content,
          mime: file.mime
        }));
        validateFileSet(kind, files, source.manifest.entry, this.limits());
        return {
          kind,
          title,
          tags,
          entry: source.manifest.entry,
          files,
          restoredFrom: input.restoreFrom,
          changedFiles: await this.changedFiles(meta, files)
        };
      }
      default:
        throw new StoreError("INVALID_UPDATE", "Unknown update mode");
    }
  }
  async changedFiles(meta, files) {
    const current = await this.readManifest(meta.id, meta.currentVersion);
    const oldByPath = new Map(current.files.map((file) => [file.path, file.sha256]));
    const newByPath = new Map(files.map((file) => [file.path, sha256(file.bytes)]));
    const changed = new Set;
    for (const file of files) {
      if (oldByPath.get(file.path) !== newByPath.get(file.path))
        changed.add(file.path);
    }
    for (const file of current.files) {
      if (!newByPath.has(file.path))
        changed.add(file.path);
    }
    return [...changed].sort();
  }
  async writeVersion(input) {
    const versionsDir = path5.join(input.artifactDir, "versions");
    await ensureDir(versionsDir);
    const version = newVersionId(input.now, input.existingVersions.at(-1));
    assertVersionId(version);
    const tempDir = path5.join(input.artifactDir, `.tmp-${version}-${randomHex(6)}`);
    await fs4.mkdir(tempDir, { mode: 448 });
    try {
      const records = [];
      let totalBytes = 0;
      for (const file of input.files) {
        const target = resolveWithin(tempDir, file.path);
        await writeFileDurable(target, file.bytes, 384);
        records.push({
          path: file.path,
          bytes: file.bytes.byteLength,
          sha256: sha256(file.bytes),
          mime: file.mime
        });
        totalBytes += file.bytes.byteLength;
      }
      const manifest = {
        schema: 1,
        kind: input.kind,
        entry: input.entry,
        title: input.title,
        createdAt: input.now.toISOString(),
        restoredFrom: input.restoredFrom,
        files: records
      };
      await writeJsonDurable(path5.join(tempDir, "manifest.json"), manifest);
      await renameWithRetry(tempDir, path5.join(versionsDir, version));
      return { id: version, manifest, totalBytes };
    } catch (error) {
      await fs4.rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  }
  async readManifest(id, version) {
    assertVersionId(version);
    const versionDir = resolveVersionDir(this.root, id, version);
    try {
      const raw = await readJson(path5.join(versionDir, "manifest.json"));
      return parseVersionManifest(raw);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        throw new StoreError("NOT_FOUND", "Version not found");
      }
      throw error;
    }
  }
  async updateMeta(id, mutate) {
    await this.ensureInit();
    assertArtifactId(id);
    const artifactDir = resolveArtifactDir(this.root, id);
    const lockDir = this.lockPath(id);
    return withArtifactLock(lockDir, async () => {
      const meta = await this.getMeta(id);
      const next = mutate(meta, this.now());
      await writeJsonAtomic(path5.join(artifactDir, "meta.json"), next);
      return next;
    }, this.lockOptions());
  }
  async readFileAt(versionDir, filePath) {
    try {
      const absolute = resolveWithin(versionDir, filePath);
      await assertRealpathWithin(versionDir, absolute);
      return await fs4.readFile(absolute);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        throw new StoreError("NOT_FOUND", "File not found");
      }
      throw error;
    }
  }
  pruneMeta(meta) {
    if (meta.versions.length <= this.versionsKept)
      return { meta, removed: [] };
    const protectedIds = new Set;
    protectedIds.add(meta.currentVersion);
    if (meta.pinnedVersion !== null)
      protectedIds.add(meta.pinnedVersion);
    const removable = meta.versions.filter((version) => !protectedIds.has(version.id));
    const excess = meta.versions.length - this.versionsKept;
    const toRemove = removable.slice(0, Math.max(0, excess));
    if (toRemove.length === 0)
      return { meta, removed: [] };
    const removed = toRemove.map((version) => version.id);
    const removedSet = new Set(removed);
    return {
      meta: { ...meta, versions: meta.versions.filter((version) => !removedSet.has(version.id)) },
      removed
    };
  }
}
function randomBytes2(size) {
  return Buffer.from(randomHex(size), "hex");
}
function normalizeTitle(title) {
  if (typeof title !== "string") {
    throw new StoreError("INVALID_ARTIFACT", "Title must be a string");
  }
  const normalized = title.trim().replace(/\s+/g, " ");
  if (normalized.length === 0 || normalized.length > 200) {
    throw new StoreError("INVALID_ARTIFACT", "Title must be 1 to 200 characters");
  }
  return normalized;
}
function normalizeTags(tags) {
  if (tags === undefined)
    return [];
  if (!Array.isArray(tags)) {
    throw new StoreError("INVALID_ARTIFACT", "Tags must be an array");
  }
  const result = [];
  const seen = new Set;
  for (const tag of tags) {
    if (typeof tag !== "string") {
      throw new StoreError("INVALID_ARTIFACT", "Tags must be strings");
    }
    const normalized = tag.trim();
    if (normalized.length === 0)
      continue;
    if (normalized.length > 32) {
      throw new StoreError("INVALID_ARTIFACT", "Tags must be at most 32 characters");
    }
    const key = normalized.toLowerCase();
    if (seen.has(key))
      continue;
    seen.add(key);
    result.push(normalized);
  }
  if (result.length > 16) {
    throw new StoreError("INVALID_ARTIFACT", "At most 16 tags are allowed");
  }
  return result;
}
function normalizeOptional(value, maxLength) {
  if (value === null || value === undefined)
    return null;
  if (typeof value !== "string") {
    throw new StoreError("INVALID_ARTIFACT", "Expected a string or null");
  }
  const normalized = value.trim();
  if (normalized.length === 0)
    return null;
  if (normalized.length > maxLength) {
    throw new StoreError("INVALID_ARTIFACT", `Value must be at most ${maxLength} characters`);
  }
  return normalized;
}
function normalizeLibrarySet(value) {
  if (value === undefined)
    return "canvas-2026-10";
  if (typeof value !== "string") {
    throw new StoreError("INVALID_ARTIFACT", "librarySet must be a string");
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 64) {
    throw new StoreError("INVALID_ARTIFACT", "librarySet must be 1 to 64 characters");
  }
  return normalized;
}
function normalizeLibraries(libraries) {
  if (libraries === undefined)
    return [];
  if (!Array.isArray(libraries) || libraries.length > 16) {
    throw new StoreError("INVALID_ARTIFACT", "libraries must contain at most 16 entries");
  }
  const seen = new Set;
  const result = [];
  for (const name of libraries) {
    if (typeof name !== "string" || !LIBRARY_NAME_RE2.test(name)) {
      throw new StoreError("INVALID_ARTIFACT", "Library names must be lowercase letters, digits, or hyphens");
    }
    if (seen.has(name))
      continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}
function normalizeLiveSources(live) {
  if (live === undefined)
    return [];
  if (!Array.isArray(live) || live.length > 8) {
    throw new StoreError("INVALID_ARTIFACT", "live must contain at most 8 entries");
  }
  const seen = new Set;
  return live.map((source) => {
    if (typeof source !== "object" || source === null) {
      throw new StoreError("INVALID_ARTIFACT", "Each live source must be an object");
    }
    if (!LIVE_SOURCE_ID_RE2.test(source.id)) {
      throw new StoreError("INVALID_ARTIFACT", "Live source id is invalid");
    }
    if (seen.has(source.id)) {
      throw new StoreError("INVALID_ARTIFACT", "Live source ids must be unique");
    }
    seen.add(source.id);
    if (source.kind !== "file") {
      throw new StoreError("INVALID_ARTIFACT", "Only file live sources are supported");
    }
    assertRelativePath(source.path);
    if (!["csv", "json", "text"].includes(source.format)) {
      throw new StoreError("INVALID_ARTIFACT", "Live source format is invalid");
    }
    if (source.refresh !== "open") {
      throw new StoreError("INVALID_ARTIFACT", "Live source refresh must be open");
    }
    if (!Number.isInteger(source.maxBytes) || source.maxBytes < 1 || source.maxBytes > 10 * 1024 * 1024) {
      throw new StoreError("INVALID_ARTIFACT", "Live source maxBytes is invalid");
    }
    return { ...source };
  });
}
function normalizeFiles(input, allowEmpty = false) {
  if (!Array.isArray(input)) {
    throw new StoreError("INVALID_ARTIFACT", "Files must be an array");
  }
  if (input.length === 0) {
    if (allowEmpty)
      return [];
    throw new StoreError("INVALID_ARTIFACT", "At least one file is required");
  }
  const seen = new Set;
  const files = [];
  for (const file of input) {
    if (typeof file !== "object" || file === null || typeof file.path !== "string") {
      throw new StoreError("INVALID_ARTIFACT", "Each file needs a path");
    }
    assertRelativePath(file.path);
    if (seen.has(file.path)) {
      throw new StoreError("INVALID_ARTIFACT", `Duplicate file path: ${file.path}`);
    }
    seen.add(file.path);
    if (typeof file.content !== "string" && !(file.content instanceof Uint8Array)) {
      throw new StoreError("INVALID_ARTIFACT", "Each file needs text or bytes");
    }
    if (file.mime !== undefined && typeof file.mime !== "string") {
      throw new StoreError("INVALID_ARTIFACT", "Each file mime must be a string");
    }
    const mime = file.mime?.trim() || mimeForPath(file.path);
    if (mime === undefined || mime.length === 0 || mime.length > 128) {
      throw new StoreError("UNSUPPORTED_FILE_TYPE", `Unsupported file type: ${path5.extname(file.path) || file.path}`);
    }
    files.push({ path: file.path, bytes: toBytes(file.content), mime });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}
function resolveEntry(kind, files, inputEntry) {
  if (inputEntry !== undefined) {
    assertRelativePath(inputEntry);
    if (!files.some((file) => file.path === inputEntry)) {
      throw new StoreError("ENTRY_NOT_FOUND", "Entry is not in files");
    }
    return inputEntry;
  }
  if (kind === "html") {
    const only = files[0];
    if (only === undefined) {
      throw new StoreError("INVALID_ARTIFACT", "An html artifact needs one file");
    }
    return only.path;
  }
  throw new StoreError("ENTRY_NOT_FOUND", "A bundle needs an entry file");
}
function validateFileSet(kind, files, entry, limits) {
  if (files.length > limits.maxBundleFiles) {
    throw new StoreError("TOO_MANY_FILES", `A bundle is limited to ${limits.maxBundleFiles} files`);
  }
  let totalBytes = 0;
  for (const file of files) {
    if (file.bytes.byteLength > limits.maxFileBytes) {
      throw new StoreError("TOO_LARGE", `A file is limited to ${limits.maxFileBytes} bytes`);
    }
    totalBytes += file.bytes.byteLength;
  }
  if (kind === "html") {
    if (files.length !== 1) {
      throw new StoreError("INVALID_ARTIFACT", "An html artifact takes exactly one file; use bundle");
    }
    if (totalBytes > limits.maxHtmlBytes) {
      throw new StoreError("TOO_LARGE", `An html artifact is limited to ${limits.maxHtmlBytes} bytes`);
    }
  } else if (kind === "bundle") {
    if (totalBytes > limits.maxBundleBytes) {
      throw new StoreError("TOO_LARGE", `A bundle is limited to ${limits.maxBundleBytes} bytes`);
    }
  } else {
    throw new StoreError("UNSUPPORTED_KIND", `${kind} artifacts are not implemented yet`);
  }
  const entryFile = files.find((file) => file.path === entry);
  if (entryFile === undefined) {
    throw new StoreError("ENTRY_NOT_FOUND", "Entry is not in files");
  }
  if (entryFile.bytes.byteLength === 0) {
    throw new StoreError("INVALID_ARTIFACT", "Entry is empty");
  }
  if (!/\.html?$/i.test(entry)) {
    throw new StoreError("INVALID_ARTIFACT", "Entry must be an HTML file");
  }
}
function summarizeVersion(id, manifest, totalBytes) {
  return {
    id,
    createdAt: manifest.createdAt,
    bytes: totalBytes,
    files: manifest.files.length,
    title: manifest.title,
    restoredFrom: manifest.restoredFrom
  };
}
function countOccurrences(haystack, needle) {
  let count = 0;
  let from = 0;
  for (;; ) {
    const at = haystack.indexOf(needle, from);
    if (at === -1)
      return count;
    count += 1;
    from = at + needle.length;
  }
}
function applyEdits(source, edits) {
  if (!Array.isArray(edits) || edits.length === 0 || edits.length > 20) {
    throw new StoreError("INVALID_UPDATE", "edits must contain 1 to 20 entries");
  }
  let result = source;
  for (let index = 0;index < edits.length; index += 1) {
    const edit = edits[index];
    if (edit === undefined || typeof edit.find !== "string" || edit.find.length === 0 || edit.find.length > 4096) {
      throw new StoreError("INVALID_UPDATE", `edits[${index}].find must be 1 to 4096 characters`);
    }
    if (typeof edit.replace !== "string" || edit.replace.length > 65536) {
      throw new StoreError("INVALID_UPDATE", `edits[${index}].replace must be 0 to 65536 characters`);
    }
    const matches = countOccurrences(result, edit.find);
    if (matches !== 1) {
      throw new StoreError("EDIT_CONFLICT", `Edit ${index} matched ${matches} times`, {
        index,
        matches
      });
    }
    const at = result.indexOf(edit.find);
    result = result.slice(0, at) + edit.replace + result.slice(at + edit.find.length);
  }
  return result;
}

// src/service/routes.ts
import * as crypto2 from "node:crypto";
import * as fs7 from "node:fs/promises";
import * as http from "node:http";
import * as path7 from "node:path";

// node_modules/fflate/esm/index.mjs
import { createRequire } from "module";
var require2 = createRequire("/");
var _a;
var Worker;
var isMarkedAsUntransferable;
try {
  _a = require2("worker_threads"), Worker = _a.Worker, isMarkedAsUntransferable = _a.isMarkedAsUntransferable;
} catch (e) {}
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0, 0]);
var fdeb = new u8([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 0, 0]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i = 0;i < 31; ++i) {
    b[i] = start += 1 << eb[i - 1];
  }
  var r = new i32(b[30]);
  for (var i = 1;i < 30; ++i) {
    for (var j = b[i];j < b[i + 1]; ++j) {
      r[j] = j - b[i] << 5 | i;
    }
  }
  return { b, r };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0;i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var hMap = function(cd, mb, r) {
  var s = cd.length;
  var i2 = 0;
  var l = new u16(mb);
  for (;i2 < s; ++i2) {
    if (cd[i2])
      ++l[cd[i2] - 1];
  }
  var le = new u16(mb);
  for (i2 = 1;i2 < mb; ++i2) {
    le[i2] = le[i2 - 1] + l[i2 - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i2 = 0;i2 < s; ++i2) {
      if (cd[i2]) {
        var sv = i2 << 4 | cd[i2];
        var r_1 = mb - cd[i2];
        var v = le[cd[i2] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1;v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i2 = 0;i2 < s; ++i2) {
      if (cd[i2]) {
        co[i2] = rev[le[cd[i2] - 1]++] >> 15 - cd[i2];
      }
    }
  }
  return co;
};
var flt = new u8(288);
for (i = 0;i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144;i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256;i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280;i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0;i < 32; ++i)
  fdt[i] = 5;
var i;
var flm = /* @__PURE__ */ hMap(flt, 9, 0);
var fdm = /* @__PURE__ */ hMap(fdt, 5, 0);
var shft = function(p) {
  return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var wbits = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
};
var wbits16 = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
  d[o + 2] |= v >> 16;
};
var hTree = function(d, mb) {
  var t = [];
  for (var i2 = 0;i2 < d.length; ++i2) {
    if (d[i2])
      t.push({ s: i2, f: d[i2] });
  }
  var s = t.length;
  var t2 = t.slice();
  if (!s)
    return { t: et, l: 0 };
  if (s == 1) {
    var v = new u8(t[0].s + 1);
    v[t[0].s] = 1;
    return { t: v, l: 1 };
  }
  t.sort(function(a, b) {
    return a.f - b.f;
  });
  t.push({ s: -1, f: 25001 });
  var l = t[0], r = t[1], i0 = 0, i1 = 1, i22 = 2;
  t[0] = { s: -1, f: l.f + r.f, l, r };
  while (i1 != s - 1) {
    l = t[t[i0].f < t[i22].f ? i0++ : i22++];
    r = t[i0 != i1 && t[i0].f < t[i22].f ? i0++ : i22++];
    t[i1++] = { s: -1, f: l.f + r.f, l, r };
  }
  var maxSym = t2[0].s;
  for (var i2 = 1;i2 < s; ++i2) {
    if (t2[i2].s > maxSym)
      maxSym = t2[i2].s;
  }
  var tr = new u16(maxSym + 1);
  var mbt = ln(t[i1 - 1], tr, 0);
  if (mbt > mb) {
    var i2 = 0, dt = 0;
    var lft = mbt - mb, cst = 1 << lft;
    t2.sort(function(a, b) {
      return tr[b.s] - tr[a.s] || a.f - b.f;
    });
    for (;i2 < s; ++i2) {
      var i2_1 = t2[i2].s;
      if (tr[i2_1] > mb) {
        dt += cst - (1 << mbt - tr[i2_1]);
        tr[i2_1] = mb;
      } else
        break;
    }
    dt >>= lft;
    while (dt > 0) {
      var i2_2 = t2[i2].s;
      if (tr[i2_2] < mb)
        dt -= 1 << mb - tr[i2_2]++ - 1;
      else
        ++i2;
    }
    for (;i2 >= 0 && dt; --i2) {
      var i2_3 = t2[i2].s;
      if (tr[i2_3] == mb) {
        --tr[i2_3];
        ++dt;
      }
    }
    mbt = mb;
  }
  return { t: new u8(tr), l: mbt };
};
var ln = function(n, l, d) {
  return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
};
var lc = function(c) {
  var s = c.length;
  while (s && !c[--s])
    ;
  var cl = new u16(++s);
  var cli = 0, cln = c[0], cls = 1;
  var w = function(v) {
    cl[cli++] = v;
  };
  for (var i2 = 1;i2 <= s; ++i2) {
    if (c[i2] == cln && i2 != s)
      ++cls;
    else {
      if (!cln && cls > 2) {
        for (;cls > 138; cls -= 138)
          w(32754);
        if (cls > 2) {
          w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
          cls = 0;
        }
      } else if (cls > 3) {
        w(cln), --cls;
        for (;cls > 6; cls -= 6)
          w(8304);
        if (cls > 2)
          w(cls - 3 << 5 | 8208), cls = 0;
      }
      while (cls--)
        w(cln);
      cls = 1;
      cln = c[i2];
    }
  }
  return { c: cl.subarray(0, cli), n: s };
};
var clen = function(cf, cl) {
  var l = 0;
  for (var i2 = 0;i2 < cl.length; ++i2)
    l += cf[i2] * cl[i2];
  return l;
};
var wfblk = function(out, pos, dat) {
  var s = dat.length;
  var o = shft(pos + 2);
  out[o] = s & 255;
  out[o + 1] = s >> 8;
  out[o + 2] = out[o] ^ 255;
  out[o + 3] = out[o + 1] ^ 255;
  for (var i2 = 0;i2 < s; ++i2)
    out[o + i2 + 4] = dat[i2];
  return (o + 4 + s) * 8;
};
var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
  wbits(out, p++, final);
  ++lf[256];
  var _a2 = hTree(lf, 15), dlt = _a2.t, mlb = _a2.l;
  var _b2 = hTree(df, 15), ddt = _b2.t, mdb = _b2.l;
  var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
  var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
  var lcfreq = new u16(19);
  for (var i2 = 0;i2 < lclt.length; ++i2)
    ++lcfreq[lclt[i2] & 31];
  for (var i2 = 0;i2 < lcdt.length; ++i2)
    ++lcfreq[lcdt[i2] & 31];
  var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
  var nlcc = 19;
  for (;nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
    ;
  var flen = bl + 5 << 3;
  var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
  var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
  if (bs >= 0 && flen <= ftlen && flen <= dtlen)
    return wfblk(out, p, dat.subarray(bs, bs + bl));
  var lm, ll, dm, dl;
  wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
  if (dtlen < ftlen) {
    lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
    var llm = hMap(lct, mlcb, 0);
    wbits(out, p, nlc - 257);
    wbits(out, p + 5, ndc - 1);
    wbits(out, p + 10, nlcc - 4);
    p += 14;
    for (var i2 = 0;i2 < nlcc; ++i2)
      wbits(out, p + 3 * i2, lct[clim[i2]]);
    p += 3 * nlcc;
    var lcts = [lclt, lcdt];
    for (var it = 0;it < 2; ++it) {
      var clct = lcts[it];
      for (var i2 = 0;i2 < clct.length; ++i2) {
        var len = clct[i2] & 31;
        wbits(out, p, llm[len]), p += lct[len];
        if (len > 15)
          wbits(out, p, clct[i2] >> 5 & 127), p += clct[i2] >> 12;
      }
    }
  } else {
    lm = flm, ll = flt, dm = fdm, dl = fdt;
  }
  for (var i2 = 0;i2 < li; ++i2) {
    var sym = syms[i2];
    if (sym > 255) {
      var len = sym >> 18 & 31;
      wbits16(out, p, lm[len + 257]), p += ll[len + 257];
      if (len > 7)
        wbits(out, p, sym >> 23 & 31), p += fleb[len];
      var dst = sym & 31;
      wbits16(out, p, dm[dst]), p += dl[dst];
      if (dst > 3)
        wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
    } else {
      wbits16(out, p, lm[sym]), p += ll[sym];
    }
  }
  wbits16(out, p, lm[256]);
  return p + ll[256];
};
var deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
var et = /* @__PURE__ */ new u8(0);
var dflt = function(dat, lvl, plvl, pre, post, st) {
  var s = st.z || dat.length;
  var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7000)) + post);
  var w = o.subarray(pre, o.length - post);
  var lst = st.l;
  var pos = (st.r || 0) & 7;
  if (lvl) {
    if (pos)
      w[0] = st.r >> 3;
    var opt = deo[lvl - 1];
    var n = opt >> 13, c = opt & 8191;
    var msk_1 = (1 << plvl) - 1;
    var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
    var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
    var hsh = function(i3) {
      return (dat[i3] ^ dat[i3 + 1] << bs1_1 ^ dat[i3 + 2] << bs2_1) & msk_1;
    };
    var syms = new i32(25000);
    var lf = new u16(288), df = new u16(32);
    var lc_1 = 0, eb = 0, i2 = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
    for (;i2 + 2 < s; ++i2) {
      var hv = hsh(i2);
      var imod = i2 & 32767, pimod = head[hv];
      prev[imod] = pimod;
      head[hv] = imod;
      if (wi <= i2) {
        var rem = s - i2;
        if ((lc_1 > 7000 || li > 24576) && (rem > 423 || !lst)) {
          pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i2 - bs, pos);
          li = lc_1 = eb = 0, bs = i2;
          for (var j = 0;j < 286; ++j)
            lf[j] = 0;
          for (var j = 0;j < 30; ++j)
            df[j] = 0;
        }
        var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
        if (rem > 2 && hv == hsh(i2 - dif)) {
          var maxn = Math.min(n, rem) - 1;
          var maxd = Math.min(32767, i2);
          var ml = Math.min(258, rem);
          while (dif <= maxd && --ch_1 && imod != pimod) {
            if (dat[i2 + l] == dat[i2 + l - dif]) {
              var nl = 0;
              for (;nl < ml && dat[i2 + nl] == dat[i2 + nl - dif]; ++nl)
                ;
              if (nl > l) {
                l = nl, d = dif;
                if (nl > maxn)
                  break;
                var mmd = Math.min(dif, nl - 2);
                var md = 0;
                for (var j = 0;j < mmd; ++j) {
                  var ti = i2 - dif + j & 32767;
                  var pti = prev[ti];
                  var cd = ti - pti & 32767;
                  if (cd > md)
                    md = cd, pimod = ti;
                }
              }
            }
            imod = pimod, pimod = prev[imod];
            dif += imod - pimod & 32767;
          }
        }
        if (d) {
          syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
          var lin = revfl[l] & 31, din = revfd[d] & 31;
          eb += fleb[lin] + fdeb[din];
          ++lf[257 + lin];
          ++df[din];
          wi = i2 + l;
          ++lc_1;
        } else {
          syms[li++] = dat[i2];
          ++lf[dat[i2]];
        }
      }
    }
    for (i2 = Math.max(i2, wi);i2 < s; ++i2) {
      syms[li++] = dat[i2];
      ++lf[dat[i2]];
    }
    pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i2 - bs, pos);
    if (!lst) {
      st.r = pos & 7 | w[pos / 8 | 0] << 3;
      pos -= 7;
      st.h = head, st.p = prev, st.i = i2, st.w = wi;
    }
  } else {
    for (var i2 = st.w || 0;i2 < s + lst; i2 += 65535) {
      var e = i2 + 65535;
      if (e >= s) {
        w[pos / 8 | 0] = lst;
        e = s;
      }
      pos = wfblk(w, pos + 1, dat.subarray(i2, e));
    }
    st.i = s;
  }
  return slc(o, 0, pre + shft(pos) + post);
};
var crct = /* @__PURE__ */ function() {
  var t = new Int32Array(256);
  for (var i2 = 0;i2 < 256; ++i2) {
    var c = i2, k = 9;
    while (--k)
      c = (c & 1 && -306674912) ^ c >>> 1;
    t[i2] = c;
  }
  return t;
}();
var crc = function() {
  var c = -1;
  return {
    p: function(d) {
      var cr = c;
      for (var i2 = 0;i2 < d.length; ++i2)
        cr = crct[cr & 255 ^ d[i2]] ^ cr >>> 8;
      c = cr;
    },
    d: function() {
      return ~c;
    }
  };
};
var dopt = function(dat, opt, pre, post, st) {
  if (!st) {
    st = { l: 1 };
    if (opt.dictionary) {
      var dict = opt.dictionary.subarray(-32768);
      var newDat = new u8(dict.length + dat.length);
      newDat.set(dict);
      newDat.set(dat, dict.length);
      dat = newDat;
      st.w = dict.length;
    }
  }
  return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
};
var mrg = function(a, b) {
  var o = {};
  for (var k in a)
    o[k] = a[k];
  for (var k in b)
    o[k] = b[k];
  return o;
};
var wbytes = function(d, b, v) {
  for (;v; ++b)
    d[b] = v, v >>>= 8;
};
function deflateSync(data, opts) {
  return dopt(data, opts || {}, 0, 0);
}
var fltn = function(d, p, t, o) {
  for (var k in d) {
    var val = d[k], n = p + k, op = o;
    if (Array.isArray(val))
      op = mrg(o, val[1]), val = val[0];
    if (ArrayBuffer.isView(val))
      t[n] = [val, op];
    else {
      t[n += "/"] = [new u8(0), op];
      fltn(val, n, t, o);
    }
  }
};
var te = typeof TextEncoder != "undefined" && /* @__PURE__ */ new TextEncoder;
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder;
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {}
function strToU8(str, latin1) {
  if (latin1) {
    var ar_1 = new u8(str.length);
    for (var i2 = 0;i2 < str.length; ++i2)
      ar_1[i2] = str.charCodeAt(i2);
    return ar_1;
  }
  if (te)
    return te.encode(str);
  var l = str.length;
  var ar = new u8(str.length + (str.length >> 1));
  var ai = 0;
  var w = function(v) {
    ar[ai++] = v;
  };
  for (var i2 = 0;i2 < l; ++i2) {
    if (ai + 5 > ar.length) {
      var n = new u8(ai + 8 + (l - i2 << 1));
      n.set(ar);
      ar = n;
    }
    var c = str.charCodeAt(i2);
    if (c < 128 || latin1)
      w(c);
    else if (c < 2048)
      w(192 | c >> 6), w(128 | c & 63);
    else if (c > 55295 && c < 57344)
      c = 65536 + (c & 1023 << 10) | str.charCodeAt(++i2) & 1023, w(240 | c >> 18), w(128 | c >> 12 & 63), w(128 | c >> 6 & 63), w(128 | c & 63);
    else
      w(224 | c >> 12), w(128 | c >> 6 & 63), w(128 | c & 63);
  }
  return slc(ar, 0, ai);
}
var exfl = function(ex) {
  var le = 0;
  if (ex) {
    for (var k in ex) {
      var l = ex[k].length;
      if (l > 65535)
        err(9);
      le += l + 4;
    }
  }
  return le;
};
var wzh = function(d, b, f, fn, u, c, ce, co) {
  var fl2 = fn.length, ex = f.extra, col = co && co.length;
  var exl = exfl(ex);
  wbytes(d, b, ce != null ? 33639248 : 67324752), b += 4;
  if (ce != null)
    d[b++] = 20, d[b++] = f.os;
  d[b] = 20, b += 2;
  d[b++] = f.flag << 1 | (c < 0 && 8), d[b++] = u && 8;
  d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
  var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
  if (y < 0 || y > 119)
    err(10);
  wbytes(d, b, y << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >> 1), b += 4;
  if (c != -1) {
    wbytes(d, b, f.crc);
    wbytes(d, b + 4, c < 0 ? -c - 2 : c);
    wbytes(d, b + 8, f.size);
  }
  wbytes(d, b + 12, fl2);
  wbytes(d, b + 14, exl), b += 16;
  if (ce != null) {
    wbytes(d, b, col);
    wbytes(d, b + 6, f.attrs);
    wbytes(d, b + 10, ce), b += 14;
  }
  d.set(fn, b);
  b += fl2;
  if (exl) {
    for (var k in ex) {
      var exf = ex[k], l = exf.length;
      wbytes(d, b, +k);
      wbytes(d, b + 2, l);
      d.set(exf, b + 4), b += 4 + l;
    }
  }
  if (col)
    d.set(co, b), b += col;
  return b;
};
var wzf = function(o, b, c, d, e) {
  wbytes(o, b, 101010256);
  wbytes(o, b + 8, c);
  wbytes(o, b + 10, c);
  wbytes(o, b + 12, d);
  wbytes(o, b + 16, e);
};
function zipSync(data, opts) {
  if (!opts)
    opts = {};
  var r = {};
  var files = [];
  fltn(data, "", r, opts);
  var o = 0;
  var tot = 0;
  for (var fn in r) {
    var _a2 = r[fn], file = _a2[0], p = _a2[1];
    var compression = p.level == 0 ? 0 : 8;
    var f = strToU8(fn), s = f.length;
    var com = p.comment, m = com && strToU8(com), ms = m && m.length;
    var exl = exfl(p.extra);
    if (s > 65535)
      err(11);
    var d = compression ? deflateSync(file, p) : file, l = d.length;
    var c = crc();
    c.p(file);
    files.push(mrg(p, {
      size: file.length,
      crc: c.d(),
      c: d,
      f,
      m,
      u: s != fn.length || m && com.length != ms,
      o,
      compression
    }));
    o += 30 + s + exl + l;
    tot += 76 + 2 * (s + exl) + (ms || 0) + l;
  }
  var out = new u8(tot + 22), oe = o, cdl = tot - o;
  for (var i2 = 0;i2 < files.length; ++i2) {
    var f = files[i2];
    wzh(out, f.o, f, f.f, f.u, f.c.length);
    var badd = 30 + f.f.length + exfl(f.extra);
    out.set(f.c, f.o + badd);
    wzh(out, o, f, f.f, f.u, f.c.length, f.o, f.m), o += 16 + badd + (f.m ? f.m.length : 0);
  }
  wzf(out, o, files.length, cdl, oe);
  return out;
}

// src/viewer/ensure.ts
import { spawn } from "node:child_process";
import * as fs5 from "node:fs/promises";
class ViewerUnavailableError extends Error {
  code = "VIEWER_UNAVAILABLE";
  constructor(message) {
    super(message);
    this.name = "ViewerUnavailableError";
  }
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readViewerState(portFile) {
  try {
    const raw = await readJson(portFile);
    if (!isRecord2(raw))
      return null;
    if (raw.schema !== 1)
      return null;
    if (typeof raw.port !== "number" || !Number.isInteger(raw.port) || raw.port <= 0)
      return null;
    if (typeof raw.pid !== "number" || !Number.isInteger(raw.pid))
      return null;
    if (typeof raw.secret !== "string" || raw.secret.length < 16)
      return null;
    if (typeof raw.startedAt !== "string")
      return null;
    return {
      schema: 1,
      port: raw.port,
      pid: raw.pid,
      secret: raw.secret,
      startedAt: raw.startedAt
    };
  } catch {
    return null;
  }
}
async function isHealthy(state) {
  const controller = new AbortController;
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/health`, {
      headers: { authorization: `Bearer ${state.secret}` },
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
async function ensureViewer(options) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const lockDir = `${options.portFile}.lock`;
  try {
    return await withArtifactLock(lockDir, async () => {
      const existing = await readViewerState(options.portFile);
      if (existing !== null && await isHealthy(existing))
        return existing;
      await ensureDir(options.storeRoot);
      await fs5.rm(options.portFile, { force: true });
      const child = spawn(process.execPath, [options.viewerEntry], {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          CANVAS_STORE: options.storeRoot,
          CANVAS_VIEWER_PORT_FILE: options.portFile,
          CANVAS_VIEWER_IDLE_MS: String(options.idleMs ?? 30 * 60 * 1000)
        }
      });
      child.unref();
      const deadline = Date.now() + timeoutMs;
      for (;; ) {
        const state = await readViewerState(options.portFile);
        if (state !== null && await isHealthy(state))
          return state;
        if (Date.now() >= deadline) {
          throw new ViewerUnavailableError("The viewer did not start within the timeout.");
        }
        await sleep(100);
      }
    }, { retryMs: 50, timeoutMs, staleMs: 30000 });
  } catch (error) {
    if (error instanceof ViewerUnavailableError)
      throw error;
    throw new ViewerUnavailableError(error instanceof Error ? error.message : "The viewer could not be started.");
  }
}
async function mintViewUrl(state, input) {
  const response = await fetch(`http://127.0.0.1:${state.port}/mint`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${state.secret}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new ViewerUnavailableError(`The viewer rejected the view request (${response.status}).`);
  }
  const body = await response.json();
  if (!isRecord2(body) || typeof body.url !== "string") {
    throw new ViewerUnavailableError("The viewer returned no view URL.");
  }
  return {
    url: body.url,
    expiresAt: typeof body.expiresAt === "number" ? body.expiresAt : 0
  };
}

// src/service/mcp-registration.ts
import * as fs6 from "node:fs/promises";
import * as os2 from "node:os";
import * as path6 from "node:path";
var MAX_CONFIG_BYTES = 512 * 1024;
var UNCHECKED_REGISTRATION = {
  checked: false,
  registered: false,
  name: null,
  disabled: false,
  commandMatch: false,
  source: null
};
function defaultMcpConfigCandidates(env = process.env) {
  const candidates = [];
  const custom = env["OPENCODE_CONFIG"]?.trim();
  if (custom !== undefined && custom.length > 0)
    candidates.push(path6.resolve(custom));
  const overrideDir = env["OPENCODE_CONFIG_DIR"]?.trim();
  const xdgDir = env["XDG_CONFIG_HOME"]?.trim();
  const dir = overrideDir !== undefined && overrideDir.length > 0 ? overrideDir : xdgDir !== undefined && xdgDir.length > 0 ? path6.join(xdgDir, "opencode") : path6.join(os2.homedir(), ".config", "opencode");
  candidates.push(path6.join(dir, "opencode.json"), path6.join(dir, "opencode.jsonc"));
  return candidates;
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stripJsonComments(text) {
  let out = "";
  let index = 0;
  let inString = false;
  while (index < text.length) {
    const char = text[index];
    if (char === undefined)
      break;
    if (inString) {
      if (char === "\\") {
        out += char + (text[index + 1] ?? "");
        index += 2;
        continue;
      }
      if (char === '"')
        inString = false;
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
    if (char === "/" && text[index + 1] === "/") {
      const end = text.indexOf(`
`, index);
      index = end === -1 ? text.length : end;
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}
function parseConfig(raw) {
  const text = stripJsonComments(raw).replace(/^\uFEFF/, "").replace(/,(\s*[}\]])/g, "$1");
  const attempts = [
    () => JSON.parse(text),
    () => JSON.parse(text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, " "))
  ];
  for (const attempt of attempts) {
    try {
      const parsed = attempt();
      return isRecord3(parsed) ? parsed : null;
    } catch {}
  }
  return null;
}
async function readEntries(file) {
  let raw;
  try {
    const stat3 = await fs6.stat(file);
    if (!stat3.isFile() || stat3.size > MAX_CONFIG_BYTES)
      return null;
    raw = await fs6.readFile(file, "utf8");
  } catch {
    return null;
  }
  const config = parseConfig(raw);
  if (config === null)
    throw new Error(`Unparseable OpenCode config at ${file}`);
  const entries = [];
  const mcp = isRecord3(config["mcp"]) ? config["mcp"] : null;
  if (mcp === null)
    return entries;
  const servers = isRecord3(mcp["servers"]) ? mcp["servers"] : null;
  if (servers !== null) {
    for (const [name, value] of Object.entries(servers)) {
      if (!isRecord3(value))
        continue;
      entries.push({ name, type: value["type"], command: value["command"], disabled: value["disabled"] === true });
    }
  }
  for (const [name, value] of Object.entries(mcp)) {
    if (name === "servers" || name === "timeout" || !isRecord3(value) || servers?.[name] !== undefined)
      continue;
    entries.push({ name, type: value["type"], command: value["command"], disabled: value["disabled"] === true || value["enabled"] === false });
  }
  return entries;
}
function commandPointsAtEntry(entry, mcpPath) {
  if (entry.type !== "local" || !Array.isArray(entry.command))
    return false;
  const last = entry.command[entry.command.length - 1];
  if (typeof last !== "string" || last.length === 0)
    return false;
  const commandPath = last.startsWith("~/") ? path6.join(os2.homedir(), last.slice(2)) : last;
  return commandPath === mcpPath;
}
async function inspectMcpRegistration(candidates, mcpPath) {
  let sawConfig = false;
  for (const file of candidates) {
    let entries;
    try {
      entries = await readEntries(file);
    } catch (error) {
      console.error("[canvas service]", error instanceof Error ? error.message : error);
      return { ...UNCHECKED_REGISTRATION };
    }
    if (entries === null)
      continue;
    sawConfig = true;
    const byPath = entries.find((entry) => commandPointsAtEntry(entry, mcpPath));
    if (byPath !== undefined) {
      return { checked: true, registered: true, name: byPath.name, disabled: byPath.disabled, commandMatch: true, source: file };
    }
    const byName = entries.find((entry) => entry.name === "canvas");
    if (byName !== undefined) {
      return { checked: true, registered: false, name: byName.name, disabled: byName.disabled, commandMatch: false, source: file };
    }
  }
  return sawConfig ? { checked: true, registered: false, name: null, disabled: false, commandMatch: false, source: null } : { ...UNCHECKED_REGISTRATION };
}

// src/service/routes.ts
var SERVICE_VERSION = "0.1.0";
var MAX_JSON_BODY = 128 * 1024;
var KINDS2 = ["html", "bundle", "markdown", "image", "pdf", "data"];

class HttpError extends Error {
  status;
  code;
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(payload, "utf8")),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(payload);
}
function sendError(response, status, code, message) {
  sendJson(response, status, { error: { code, message } });
}
async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_JSON_BODY) {
      throw new HttpError(413, "TOO_LARGE", "Request body is too large");
    }
    chunks.push(buffer);
  }
  if (size === 0)
    return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be JSON");
  }
}
function requireToken(request, response, token) {
  const header = request.headers.authorization;
  const expected = `Bearer ${token}`;
  if (typeof header !== "string" || header.length !== expected.length || !crypto2.timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
    sendError(response, 401, "UNAUTHORIZED", "Invalid service token");
    return false;
  }
  return true;
}
function parseInteger(value, name) {
  if (value === null || value.length === 0)
    return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, "INVALID_REQUEST", `${name} must be a positive integer`);
  }
  return parsed;
}
function isKind2(value) {
  return value !== null && KINDS2.includes(value);
}
function sendStoreError(response, error) {
  const status = error.code === "NOT_FOUND" || error.code === "PATH_NOT_FOUND" ? 404 : error.code === "INVALID_PATH" || error.code === "INVALID_ARTIFACT" || error.code === "INVALID_UPDATE" ? 400 : error.code === "TOO_LARGE" || error.code === "TOO_MANY_FILES" ? 413 : error.code === "CONFLICT" ? 409 : 500;
  sendError(response, status, error.code, error.message);
}
async function createServiceServer(options) {
  const host = options.host ?? "127.0.0.1";
  let port = options.port ?? 0;
  let isClosed = false;
  let resolveClosed = null;
  const closed = new Promise((resolve4) => {
    resolveClosed = resolve4;
  });
  const startedAt = Date.now();
  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof HttpError) {
        sendError(response, error.status, error.code, error.message);
        return;
      }
      if (error instanceof ViewerUnavailableError) {
        sendError(response, 503, error.code, error.message);
        return;
      }
      if (isStoreError(error)) {
        sendStoreError(response, error);
        return;
      }
      sendError(response, 500, "INTERNAL", error instanceof Error ? error.message : "Internal error");
    });
  });
  const close = async () => {
    if (isClosed)
      return;
    isClosed = true;
    await new Promise((resolve4) => {
      server.close(() => resolve4());
      server.closeAllConnections();
    });
    resolveClosed?.();
  };
  await new Promise((resolve4, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      if (address !== null && typeof address === "object")
        port = address.port;
      resolve4();
    });
  });
  async function handleRequest(request, response) {
    if (!requireToken(request, response, options.token))
      return;
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname === "/health" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        pid: process.pid,
        uptime: Date.now() - startedAt,
        store: path7.basename(options.storeRoot),
        version: SERVICE_VERSION,
        mcpPath: options.mcpPath
      });
      return;
    }
    if (url.pathname === "/list" && request.method === "GET") {
      const directory = url.searchParams.get("directory") ?? undefined;
      const query = url.searchParams.get("query") ?? undefined;
      const kindValue = url.searchParams.get("kind");
      const tag = url.searchParams.get("tag") ?? undefined;
      const limit = parseInteger(url.searchParams.get("limit"), "limit");
      const archived = url.searchParams.get("archived");
      if (kindValue !== null && !isKind2(kindValue)) {
        throw new HttpError(400, "INVALID_REQUEST", "kind is invalid");
      }
      const result = await options.store.list({
        directory,
        query,
        kind: kindValue === null ? undefined : kindValue,
        tag,
        limit,
        includeArchived: archived === "true" || archived === "1"
      });
      sendJson(response, 200, result);
      return;
    }
    const artifactMatch = /^\/artifact\/([^/]+)$/.exec(url.pathname);
    if (artifactMatch !== null && request.method === "GET") {
      const id = decode(artifactMatch[1] ?? "");
      if (id === null)
        throw new HttpError(404, "NOT_FOUND", "Not found");
      sendJson(response, 200, await options.store.getMeta(id));
      return;
    }
    const versionsMatch = /^\/versions\/([^/]+)$/.exec(url.pathname);
    if (versionsMatch !== null && request.method === "GET") {
      const id = decode(versionsMatch[1] ?? "");
      if (id === null)
        throw new HttpError(404, "NOT_FOUND", "Not found");
      sendJson(response, 200, { versions: await options.store.getVersions(id) });
      return;
    }
    if (url.pathname === "/view-url" && request.method === "POST") {
      const body = await readJsonBody(request);
      if (!isRecord4(body) || typeof body.id !== "string") {
        throw new HttpError(400, "INVALID_REQUEST", "id is required");
      }
      const version = typeof body.version === "string" ? body.version : undefined;
      const theme = body.theme === "light" || body.theme === "dark" ? body.theme : undefined;
      const viewer = await ensureViewer({
        storeRoot: options.storeRoot,
        portFile: options.portFile,
        viewerEntry: options.viewerEntry,
        timeoutMs: options.viewerTimeoutMs
      });
      const minted = await mintViewUrl(viewer, { id: body.id, version, theme });
      sendJson(response, 200, minted);
      return;
    }
    const feedbackMatch = /^\/feedback\/([^/]+)$/.exec(url.pathname);
    if (feedbackMatch !== null) {
      const id = decode(feedbackMatch[1] ?? "");
      if (id === null)
        throw new HttpError(404, "NOT_FOUND", "Not found");
      if (request.method === "GET") {
        const since = url.searchParams.get("since") ?? undefined;
        const limit = parseInteger(url.searchParams.get("limit"), "limit");
        sendJson(response, 200, {
          responses: await options.store.listFeedback(id, { since, limit })
        });
        return;
      }
      if (request.method === "POST") {
        const body = await readJsonBody(request);
        if (!isRecord4(body) || !Array.isArray(body.ids)) {
          throw new HttpError(400, "INVALID_REQUEST", "ids must be an array");
        }
        const ids = body.ids.filter((value) => typeof value === "string");
        const delivered = await options.store.markFeedbackDelivered(id, ids);
        sendJson(response, 200, { delivered });
        return;
      }
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET or POST");
    }
    const archiveMatch = /^\/archive\/([^/]+)$/.exec(url.pathname);
    if (archiveMatch !== null && request.method === "POST") {
      const id = decode(archiveMatch[1] ?? "");
      if (id === null)
        throw new HttpError(404, "NOT_FOUND", "Not found");
      const body = await readJsonBody(request);
      const archived = !isRecord4(body) || body.archived !== false;
      sendJson(response, 200, await options.store.archive(id, archived));
      return;
    }
    const favoriteMatch = /^\/favorite\/([^/]+)$/.exec(url.pathname);
    if (favoriteMatch !== null && request.method === "POST") {
      const id = decode(favoriteMatch[1] ?? "");
      if (id === null)
        throw new HttpError(404, "NOT_FOUND", "Not found");
      const body = await readJsonBody(request);
      const favorite = !isRecord4(body) || body.favorite !== false;
      sendJson(response, 200, await options.store.setFavorite(id, favorite));
      return;
    }
    const restoreMatch = /^\/restore\/([^/]+)$/.exec(url.pathname);
    if (restoreMatch !== null && request.method === "POST") {
      const id = decode(restoreMatch[1] ?? "");
      if (id === null)
        throw new HttpError(404, "NOT_FOUND", "Not found");
      const body = await readJsonBody(request);
      if (!isRecord4(body) || typeof body.version !== "string" || typeof body.baseVersion !== "string") {
        throw new HttpError(400, "INVALID_REQUEST", "version and baseVersion are required");
      }
      const updated = await options.store.update(id, {
        mode: "restore",
        restoreFrom: body.version,
        baseVersion: body.baseVersion
      });
      sendJson(response, 200, { version: updated.version });
      return;
    }
    if (url.pathname === "/trash" && request.method === "GET") {
      sendJson(response, 200, { artifacts: await options.store.listTrash() });
      return;
    }
    const trashMatch = /^\/trash\/([^/]+)$/.exec(url.pathname);
    if (trashMatch !== null && request.method === "POST") {
      const id = decode(trashMatch[1] ?? "");
      if (id === null)
        throw new HttpError(404, "NOT_FOUND", "Not found");
      await options.store.trash(id);
      sendJson(response, 200, { trashed: true });
      return;
    }
    const untrashMatch = /^\/untrash\/([^/]+)$/.exec(url.pathname);
    if (untrashMatch !== null && request.method === "POST") {
      const id = decode(untrashMatch[1] ?? "");
      if (id === null)
        throw new HttpError(404, "NOT_FOUND", "Not found");
      sendJson(response, 200, await options.store.untrash(id));
      return;
    }
    const exportMatch = /^\/export\/([^/]+)$/.exec(url.pathname);
    if (exportMatch !== null && request.method === "POST") {
      const id = decode(exportMatch[1] ?? "");
      if (id === null)
        throw new HttpError(404, "NOT_FOUND", "Not found");
      const body = await readJsonBody(request);
      const version = isRecord4(body) && typeof body.version === "string" ? body.version : undefined;
      const requestedFormat = isRecord4(body) && (body.format === "html" || body.format === "zip") ? body.format : undefined;
      sendJson(response, 200, await exportArtifact(options.store, options.storeRoot, id, version, requestedFormat));
      return;
    }
    if (url.pathname === "/mcp-registration" && request.method === "GET") {
      const candidates = options.mcpConfigCandidates ?? defaultMcpConfigCandidates();
      sendJson(response, 200, await inspectMcpRegistration(candidates, options.mcpPath));
      return;
    }
    if (url.pathname === "/mcp-status" && request.method === "GET") {
      try {
        const raw = await readJson(path7.join(options.storeRoot, ".mcp-heartbeat.json"));
        sendJson(response, 200, isRecord4(raw) ? raw : null);
      } catch {
        sendJson(response, 200, null);
      }
      return;
    }
    const thumbMatch = /^\/thumb\/([^/]+)$/.exec(url.pathname);
    if (thumbMatch !== null && request.method === "GET") {
      throw new HttpError(404, "NOT_FOUND", "Thumbnails are not implemented yet");
    }
    throw new HttpError(404, "NOT_FOUND", "Not found");
  }
  return { server, host, port, closed, close };
}
async function exportArtifact(store, storeRoot, id, version, requestedFormat) {
  const result = await store.readVersion(id, version);
  const format = requestedFormat ?? (result.meta.kind === "html" ? "html" : "zip");
  const exportsDir = path7.join(storeRoot, "exports");
  await ensureDir(exportsDir);
  if (format === "html") {
    const entry = result.files.find((file) => file.path === result.manifest.entry);
    if (entry === undefined) {
      throw new StoreError("ENTRY_NOT_FOUND", "The entry file is missing");
    }
    const target2 = path7.join(exportsDir, `${id}-${result.version}.html`);
    await fs7.writeFile(target2, entry.content, { mode: 384 });
    return { path: target2, format, bytes: entry.content.byteLength };
  }
  const entries = {};
  for (const file of result.files) {
    entries[file.path] = file.content;
  }
  const zipped = zipSync(entries);
  const target = path7.join(exportsDir, `${id}-${result.version}.zip`);
  await fs7.writeFile(target, zipped, { mode: 384 });
  return { path: target, format, bytes: zipped.byteLength };
}

// src/service/main.ts
var moduleDir = path8.dirname(fileURLToPath(import.meta.url));
async function main() {
  const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
  const token = process.env.OPENCHAMBER_SERVICE_TOKEN;
  if (!Number.isInteger(port) || port <= 0) {
    console.error("[canvas service] OPENCHAMBER_SERVICE_PORT is missing or invalid");
    process.exit(1);
  }
  if (token === undefined || token.length === 0) {
    console.error("[canvas service] OPENCHAMBER_SERVICE_TOKEN is missing");
    process.exit(1);
  }
  const configuredStore = process.env.CANVAS_STORE?.trim();
  const storeRoot = configuredStore !== undefined && configuredStore.length > 0 ? path8.resolve(configuredStore) : defaultStoreRoot();
  const configuredPortFile = process.env.CANVAS_VIEWER_PORT_FILE?.trim();
  const portFile = configuredPortFile !== undefined && configuredPortFile.length > 0 ? path8.resolve(configuredPortFile) : defaultViewerPortFile(storeRoot);
  const configuredViewerEntry = process.env.CANVAS_VIEWER_ENTRY?.trim();
  const viewerEntry = configuredViewerEntry !== undefined && configuredViewerEntry.length > 0 ? path8.resolve(configuredViewerEntry) : path8.join(moduleDir, "..", "viewer", "server.js");
  const parsedTimeout = Number(process.env.CANVAS_VIEWER_TIMEOUT_MS ?? "");
  const viewerTimeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 15000;
  const store = new ArtifactStore({ root: storeRoot });
  await store.init();
  const service = await createServiceServer({
    store,
    token,
    storeRoot,
    portFile,
    viewerEntry,
    mcpPath: path8.join(moduleDir, "..", "mcp", "server.js"),
    viewerTimeoutMs,
    host: "127.0.0.1",
    port
  });
  console.error(`[canvas service] listening on ${service.port}`);
  const shutdown = () => {
    service.close();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  await service.closed;
}
try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
