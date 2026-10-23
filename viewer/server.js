// src/viewer/server.ts
import * as crypto3 from "node:crypto";
import * as fs5 from "node:fs/promises";
import * as http from "node:http";
import * as path6 from "node:path";
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
      const existing = await this.findByDedupeKey(dedupeKey, kind, directory);
      if (existing !== null) {
        if (await this.hasSameFiles(existing.id, existing.version, files)) {
          return existing;
        }
        const updated = await this.update(existing.id, {
          mode: "replace",
          files: files.map((file) => ({ path: file.path, content: file.bytes })),
          entry,
          title,
          tags
        });
        return { id: existing.id, version: updated.version, meta: updated.meta, deduped: true };
      }
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
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "trash" || entry.name === "exports")
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
  async findByDedupeKey(key, kind, directory) {
    const metas = await this.readAllMetas();
    const found = metas.find((meta) => meta.dedupeKey === key && meta.directory === directory);
    if (found === undefined || found.kind !== kind)
      return null;
    return { id: found.id, version: found.currentVersion, meta: found, deduped: true };
  }
  async hasSameFiles(id, version, files) {
    const current = await this.readVersion(id, version);
    if (current.files.length !== files.length)
      return false;
    for (const file of current.files) {
      const source = files.find((entry) => entry.path === file.path);
      if (source === undefined)
        return false;
      if (!Buffer.from(source.bytes).equals(Buffer.from(file.content)))
        return false;
    }
    return true;
  }
  async readAllMetas() {
    const entries = await fs4.readdir(this.root, { withFileTypes: true });
    const metas = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "trash" || entry.name === "exports")
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

// src/viewer/policy.ts
import * as crypto2 from "node:crypto";
var PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "clipboard-read=()",
  "clipboard-write=()"
].join(", ");
function isLoopbackHost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}
function assertLoopbackHost(host) {
  if (!isLoopbackHost(host)) {
    throw new StoreError("INVALID_PATH", "The viewer host must be loopback");
  }
}
function normalizeHost(host) {
  return host === "::1" ? "[::1]" : host;
}
function buildCsp(kind, host, port) {
  const origin = `http://${normalizeHost(host)}:${port}`;
  if (kind === "html" || kind === "bundle" || kind === "data") {
    return [
      "sandbox allow-scripts",
      "default-src 'none'",
      `script-src ${origin} 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'`,
      `style-src ${origin} 'unsafe-inline'`,
      `img-src ${origin} data: blob:`,
      `font-src ${origin} data:`,
      `media-src ${origin} data: blob:`,
      `connect-src ${origin}`,
      "worker-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "manifest-src 'none'"
    ].join("; ");
  }
  if (kind === "markdown") {
    return [
      "sandbox",
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      `img-src ${origin} data:`,
      `font-src ${origin} data:`,
      "connect-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "base-uri 'none'"
    ].join("; ");
  }
  if (kind === "image") {
    return ["sandbox", "default-src 'none'", "style-src 'unsafe-inline'"].join("; ");
  }
  return null;
}
function viewHeaders(input) {
  assertLoopbackHost(input.host);
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new StoreError("INVALID_PATH", "The viewer port is invalid");
  }
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "cross-origin"
  };
  const csp = buildCsp(input.kind, input.host, input.port);
  if (csp !== null)
    headers["Content-Security-Policy"] = csp;
  if (input.kind === "html" || input.kind === "bundle" || input.kind === "markdown" || input.kind === "data") {
    headers["Content-Type"] = "text/html; charset=utf-8";
  } else if (input.kind === "pdf") {
    headers["Content-Type"] = "application/pdf";
    headers["Content-Disposition"] = "inline";
  }
  return headers;
}
function runtimeCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin"
  };
}
function contentTypeFor(filePath) {
  return mimeForPath(filePath) ?? "application/octet-stream";
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
function signViewToken(secret, id, version, expiresAt) {
  assertArtifactId(id);
  assertVersionId(version);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new StoreError("INVALID_PATH", "The view token expiry is invalid");
  }
  const payload = encodePayload({ id, version, expiresAt });
  const signature = crypto2.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function verifyViewToken(secret, token, now = Date.now()) {
  const parts = token.split(".");
  if (parts.length !== 2)
    return null;
  const payload = parts[0];
  const signature = parts[1];
  if (payload === undefined || signature === undefined)
    return null;
  const expected = crypto2.createHmac("sha256", secret).update(payload).digest();
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length || !crypto2.timingSafeEqual(provided, expected)) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord2(parsed))
    return null;
  const { id, version, expiresAt } = parsed;
  if (typeof id !== "string" || !ARTIFACT_ID_RE.test(id))
    return null;
  if (typeof version !== "string" || !VERSION_ID_RE.test(version))
    return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= now)
    return null;
  return { id, version };
}

// src/viewer/server.ts
var VIEW_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
var MAX_JSON_BODY = 128 * 1024;
var HEARTBEAT_MS = 15000;

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
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
function injectRuntime(html, source, libraryTags) {
  const runtimeTag = source.length === 0 ? "" : `<script>${source.replace(/<\/script/gi, "<\\/script")}</script>`;
  const tags = `${libraryTags}${runtimeTag}`;
  if (tags.length === 0)
    return html;
  const head = /<head[^>]*>/i.exec(html);
  if (head !== null) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tags + html.slice(at);
  }
  const body = /<body[^>]*>/i.exec(html);
  if (body !== null) {
    const at = body.index + body[0].length;
    return html.slice(0, at) + tags + html.slice(at);
  }
  return tags + html;
}
async function readRuntimeSource(file) {
  try {
    return await fs5.readFile(file, "utf8");
  } catch {
    return "";
  }
}
function sendJson(response, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(payload, "utf8")),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra
  });
  response.end(payload);
}
function sendError(response, status, code, message) {
  sendJson(response, status, { error: { code, message } }, runtimeCorsHeaders());
}
async function readJsonBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) {
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
function requireSecret(request, response, secret) {
  const header = request.headers.authorization;
  const expected = `Bearer ${secret}`;
  if (typeof header !== "string" || header.length !== expected.length || !crypto3.timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
    sendError(response, 401, "UNAUTHORIZED", "Invalid viewer secret");
    return false;
  }
  return true;
}
async function loadLibraries(directory) {
  try {
    const raw = await readJson(path6.join(directory, "manifest.json"));
    if (!isRecord3(raw) || raw.schema !== 1)
      return null;
    if (typeof raw.set !== "string" || raw.set.length === 0)
      return null;
    if (!isRecord3(raw.libraries))
      return null;
    const libraries = {};
    for (const [name, value] of Object.entries(raw.libraries)) {
      if (!isRecord3(value))
        continue;
      if (typeof value.file !== "string" || path6.basename(value.file) !== value.file)
        continue;
      if (typeof value.bytes !== "number" || typeof value.sha256 !== "string")
        continue;
      libraries[name] = { file: value.file, bytes: value.bytes, sha256: value.sha256 };
    }
    const verified = {};
    for (const [name, record] of Object.entries(libraries)) {
      try {
        const bytes = await fs5.readFile(path6.join(directory, record.file));
        const hash = crypto3.createHash("sha256").update(bytes).digest("hex");
        if (hash !== record.sha256 || bytes.byteLength !== record.bytes)
          continue;
        verified[name] = record;
      } catch {
        continue;
      }
    }
    return { schema: 1, set: raw.set, libraries: verified };
  } catch {
    return null;
  }
}
async function createViewerServer(options) {
  const host = options.host ?? "127.0.0.1";
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const libraries = await loadLibraries(options.librariesDir);
  const runtimeSource = await readRuntimeSource(options.runtimeFile);
  const libraryTags = (names) => names.filter((name) => libraries?.libraries[name] !== undefined).map((name) => `<script src="/libraries/${name}.js"></script>`).join("");
  const sseClients = new Map;
  let port = options.port ?? 0;
  let lastActivity = now();
  let isClosed = false;
  let resolveClosed = null;
  const closed = new Promise((resolve4) => {
    resolveClosed = resolve4;
  });
  const server = http.createServer((request, response) => {
    lastActivity = now();
    handleRequest(request, response).catch((error) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof HttpError) {
        sendError(response, error.status, error.code, error.message);
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
    clearInterval(idleTimer);
    for (const clients of sseClients.values()) {
      for (const client of clients)
        client.end();
    }
    sseClients.clear();
    await new Promise((resolve4) => {
      server.close(() => resolve4());
      server.closeAllConnections();
    });
    resolveClosed?.();
  };
  const idleMs = options.idleMs ?? 30 * 60 * 1000;
  const idleTimer = setInterval(() => {
    if (isClosed)
      return;
    if (sseClients.size > 0) {
      lastActivity = now();
      return;
    }
    if (now() - lastActivity >= idleMs) {
      close().then(() => options.onIdle?.());
    }
  }, Math.min(Math.max(Math.floor(idleMs / 2), 10), 60000));
  idleTimer.unref();
  await new Promise((resolve4, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      if (address !== null && typeof address === "object") {
        port = address.port;
      }
      resolve4();
    });
  });
  async function handleRequest(request, response) {
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (request.method === "OPTIONS") {
      response.writeHead(204, runtimeCorsHeaders());
      response.end();
      return;
    }
    if (url.pathname === "/health") {
      if (!requireSecret(request, response, options.secret))
        return;
      sendJson(response, 200, {
        ok: true,
        pid: process.pid,
        uptime: now() - startedAt,
        store: path6.basename(options.store.storeRoot),
        librarySet: libraries?.set ?? null
      }, runtimeCorsHeaders());
      return;
    }
    if (url.pathname === "/mint") {
      await handleMint(request, response);
      return;
    }
    if (url.pathname === "/notify") {
      await handleNotify(request, response);
      return;
    }
    if (url.pathname === "/runtime/canvas.js") {
      await handleRuntime(response);
      return;
    }
    if (url.pathname.startsWith("/libraries/")) {
      await handleLibrary(url, response);
      return;
    }
    if (url.pathname.startsWith("/view/")) {
      await handleView(url, response);
      return;
    }
    if (url.pathname.startsWith("/events/")) {
      handleEvents(request, response, url);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    if (url.pathname.startsWith("/data/")) {
      await handleData(url);
      return;
    }
    if (url.pathname.startsWith("/thumb/")) {
      throw new HttpError(404, "NOT_FOUND", "Thumbnail not found");
    }
    throw new HttpError(404, "NOT_FOUND", "Not found");
  }
  async function handleMint(request, response) {
    if (!requireSecret(request, response, options.secret))
      return;
    if (request.method !== "POST")
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST");
    const body = await readJsonBody(request, 16 * 1024);
    if (!isRecord3(body) || typeof body.id !== "string") {
      throw new HttpError(400, "INVALID_REQUEST", "id is required");
    }
    const versionInput = typeof body.version === "string" ? body.version : undefined;
    if (body.version !== undefined && versionInput === undefined) {
      throw new HttpError(400, "INVALID_REQUEST", "version must be a string");
    }
    const result = await options.store.read(body.id, versionInput);
    const expiresAt = now() + VIEW_TOKEN_TTL_MS;
    const token = signViewToken(options.secret, body.id, result.version, expiresAt);
    const theme = body.theme === "light" || body.theme === "dark" ? `?theme=${body.theme}` : "";
    sendJson(response, 200, {
      url: `http://${host}:${port}/view/${token}/${body.id}/${result.version}/${theme}`,
      expiresAt
    }, runtimeCorsHeaders());
  }
  async function handleNotify(request, response) {
    if (!requireSecret(request, response, options.secret))
      return;
    if (request.method !== "POST")
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST");
    const body = await readJsonBody(request, 16 * 1024);
    if (!isRecord3(body) || typeof body.id !== "string") {
      throw new HttpError(400, "INVALID_REQUEST", "id is required");
    }
    const event = body.event;
    if (event !== "changed" && event !== "deleted") {
      throw new HttpError(400, "INVALID_REQUEST", "event must be changed or deleted");
    }
    assertArtifactId(body.id);
    let message;
    if (event === "changed") {
      if (typeof body.version !== "string" || body.version.length === 0) {
        throw new HttpError(400, "INVALID_REQUEST", "version is required for changed");
      }
      const expiresAt = now() + VIEW_TOKEN_TTL_MS;
      const token = signViewToken(options.secret, body.id, body.version, expiresAt);
      message = {
        event: "changed",
        id: body.id,
        version: body.version,
        url: `http://${host}:${port}/view/${token}/${body.id}/${body.version}/`
      };
    } else {
      message = { event: "deleted", id: body.id };
    }
    const clients = sseClients.get(body.id);
    const payload = `data: ${JSON.stringify(message)}

`;
    for (const client of clients ?? []) {
      try {
        client.write(payload);
      } catch {
        clients?.delete(client);
      }
    }
    sendJson(response, 200, { notified: clients?.size ?? 0 }, runtimeCorsHeaders());
  }
  async function handleView(url, response) {
    const match = /^\/view\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/.exec(url.pathname);
    if (!match)
      throw new HttpError(404, "NOT_FOUND", "Not found");
    const token = decode(match[1] ?? "");
    const id = decode(match[2] ?? "");
    const version = decode(match[3] ?? "");
    const rest = match[4] ?? "";
    if (token === null || id === null || version === null) {
      throw new HttpError(404, "NOT_FOUND", "Not found");
    }
    const payload = verifyViewToken(options.secret, token, now());
    if (payload === null || payload.id !== id || payload.version !== version) {
      throw new HttpError(404, "NOT_FOUND", "Not found");
    }
    const result = await options.store.read(id, version);
    const kind = result.meta.kind;
    if (kind !== "html" && kind !== "bundle") {
      throw new HttpError(501, "UNSUPPORTED_KIND", `${kind} artifacts are not implemented yet`);
    }
    const relative2 = rest.length === 0 ? result.manifest.entry : rest;
    if (relative2 === result.manifest.entry) {
      const bytes2 = await options.store.readFile(id, version, relative2);
      let html;
      try {
        html = new TextDecoder("utf-8", { fatal: true }).decode(bytes2);
      } catch {
        throw new HttpError(500, "INVALID_ARTIFACT", "Entry is not valid UTF-8");
      }
      const injected = injectRuntime(html, runtimeSource, libraryTags(result.meta.libraries));
      const headers2 = viewHeaders({ kind, host, port });
      headers2["Content-Length"] = String(Buffer.byteLength(injected, "utf8"));
      response.writeHead(200, headers2);
      response.end(injected);
      return;
    }
    const bytes = await options.store.readFile(id, version, relative2);
    const headers = {
      "Content-Type": contentTypeFor(relative2),
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Access-Control-Allow-Origin": "null"
    };
    if (relative2.toLowerCase().endsWith(".svg")) {
      headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
    }
    response.writeHead(200, headers);
    response.end(bytes);
  }
  async function handleRuntime(response) {
    if (runtimeSource.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "Runtime not built");
    }
    const bytes = Buffer.from(runtimeSource, "utf8");
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Access-Control-Allow-Origin": "null"
    });
    response.end(bytes);
  }
  async function handleLibrary(url, response) {
    let name = decode(url.pathname.slice("/libraries/".length));
    if (name === null)
      throw new HttpError(404, "NOT_FOUND", "Not found");
    if (name.endsWith(".js"))
      name = name.slice(0, -3);
    const library = libraries?.libraries[name];
    if (library === undefined)
      throw new HttpError(404, "NOT_FOUND", "Library not found");
    let bytes;
    try {
      bytes = await fs5.readFile(path6.join(options.librariesDir, library.file));
    } catch {
      throw new HttpError(404, "NOT_FOUND", "Library file not found");
    }
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Access-Control-Allow-Origin": "null"
    });
    response.end(bytes);
  }
  function handleEvents(request, response, url) {
    const match = /^\/events\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (!match)
      throw new HttpError(404, "NOT_FOUND", "Not found");
    const token = decode(match[1] ?? "");
    const id = decode(match[2] ?? "");
    if (token === null || id === null) {
      throw new HttpError(404, "NOT_FOUND", "Not found");
    }
    const payload = verifyViewToken(options.secret, token, now());
    if (payload === null || payload.id !== id) {
      throw new HttpError(404, "NOT_FOUND", "Not found");
    }
    response.writeHead(200, {
      ...runtimeCorsHeaders(),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    response.write(`data: ready

`);
    const clients = sseClients.get(id) ?? new Set;
    clients.add(response);
    sseClients.set(id, clients);
    let cleaned = false;
    const heartbeat = setInterval(() => {
      try {
        response.write(`data: ping

`);
      } catch {}
    }, HEARTBEAT_MS);
    const cleanup = () => {
      if (cleaned)
        return;
      cleaned = true;
      clearInterval(heartbeat);
      clients.delete(response);
      if (clients.size === 0)
        sseClients.delete(id);
    };
    request.on("close", cleanup);
    response.on("close", cleanup);
  }
  async function handleApi(request, response, url) {
    const match = /^\/api\/([^/]+)\/(state|feedback|refresh)$/.exec(url.pathname);
    if (!match)
      throw new HttpError(404, "NOT_FOUND", "Not found");
    const token = decode(match[1] ?? "");
    const action = match[2];
    if (token === null || action === undefined) {
      throw new HttpError(404, "NOT_FOUND", "Not found");
    }
    const payload = verifyViewToken(options.secret, token, now());
    if (payload === null)
      throw new HttpError(404, "NOT_FOUND", "Not found");
    if (action === "state") {
      if (request.method === "GET") {
        const state2 = await options.store.readState(payload.id);
        sendJson(response, 200, { state: state2 }, runtimeCorsHeaders());
        return;
      }
      if (request.method !== "POST") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET or POST");
      }
      const body = await readJsonBody(request, MAX_JSON_BODY);
      if (!isRecord3(body) || typeof body.key !== "string") {
        throw new HttpError(400, "INVALID_REQUEST", "key is required");
      }
      const remove = body.delete === true;
      const value = body.value;
      if (!remove && !isJsonValue(value)) {
        throw new HttpError(400, "INVALID_REQUEST", "value must be JSON");
      }
      const state = await options.store.writeStateKey(payload.id, body.key, remove ? undefined : value);
      sendJson(response, 200, { ok: true, state }, runtimeCorsHeaders());
      return;
    }
    if (action === "feedback") {
      if (request.method !== "POST") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST");
      }
      const body = await readJsonBody(request, MAX_JSON_BODY);
      if (!isRecord3(body) || !isJsonValue(body.data)) {
        throw new HttpError(400, "INVALID_REQUEST", "data must be JSON");
      }
      const kind = typeof body.kind === "string" ? body.kind : "form";
      const record = await options.store.addFeedback(payload.id, {
        version: payload.version,
        kind,
        data: body.data
      });
      sendJson(response, 200, { id: record.id, createdAt: record.createdAt }, runtimeCorsHeaders());
      return;
    }
    if (request.method !== "POST") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST");
    }
    sendJson(response, 200, { ok: true }, runtimeCorsHeaders());
  }
  async function handleData(url) {
    const match = /^\/data\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (!match)
      throw new HttpError(404, "NOT_FOUND", "Not found");
    const token = decode(match[1] ?? "");
    if (token === null)
      throw new HttpError(404, "NOT_FOUND", "Not found");
    const payload = verifyViewToken(options.secret, token, now());
    if (payload === null)
      throw new HttpError(404, "NOT_FOUND", "Not found");
    throw new HttpError(501, "UNSUPPORTED", "Live sources are not implemented yet");
  }
  function sendStoreError(response, error) {
    const status = error.code === "NOT_FOUND" || error.code === "PATH_NOT_FOUND" ? 404 : error.code === "INVALID_PATH" || error.code === "INVALID_ARTIFACT" ? 400 : error.code === "TOO_LARGE" || error.code === "TOO_MANY_FILES" ? 413 : 500;
    sendError(response, status, error.code, error.message);
  }
  return {
    server,
    host,
    port,
    secret: options.secret,
    closed,
    close
  };
}
async function main() {
  const storeRoot = defaultStoreRoot();
  const portFile = process.env.CANVAS_VIEWER_PORT_FILE ?? defaultViewerPortFile(storeRoot);
  const idleMs = Number(process.env.CANVAS_VIEWER_IDLE_MS ?? 30 * 60 * 1000);
  const store = new ArtifactStore({ root: storeRoot });
  await store.init();
  const secret = crypto3.randomBytes(32).toString("hex");
  const viewerDir = path6.dirname(fileURLToPath(import.meta.url));
  const viewer = await createViewerServer({
    store,
    secret,
    runtimeFile: path6.join(viewerDir, "runtime", "canvas.js"),
    librariesDir: path6.join(viewerDir, "libraries"),
    idleMs,
    onIdle: () => process.exit(0)
  });
  await ensureDir(path6.dirname(portFile));
  await writeJsonAtomic(portFile, {
    schema: 1,
    port: viewer.port,
    pid: process.pid,
    secret,
    startedAt: new Date().toISOString()
  });
  console.error(`[canvas viewer] listening on ${viewer.port}`);
  const shutdown = () => {
    viewer.close();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  await viewer.closed;
}
var isMain = process.argv[1] !== undefined && path6.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
export {
  createViewerServer
};
