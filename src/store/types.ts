export type ArtifactKind = 'html' | 'bundle' | 'markdown' | 'image' | 'pdf' | 'data';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface FeedbackRecord {
  schema: 1;
  id: string;
  artifactId: string;
  version: string;
  createdAt: string;
  kind: string;
  data: JsonValue;
  deliveredAt: string | null;
}

export interface AddFeedbackInput {
  version: string;
  kind?: string;
  data: JsonValue;
}

export interface ListFeedbackOptions {
  since?: string;
  limit?: number;
  offset?: number;
}

export interface RuntimeState {
  [key: string]: JsonValue;
}

export interface ArtifactFileInput {
  path: string;
  content: string | Uint8Array;
  mime?: string;
}

export interface ArtifactFileRecord {
  path: string;
  bytes: number;
  sha256: string;
  mime: string;
}

export interface VersionManifest {
  schema: 1;
  kind: ArtifactKind;
  entry: string;
  title: string;
  createdAt: string;
  restoredFrom: string | null;
  files: ArtifactFileRecord[];
  rendering?: string;
}

export interface VersionSummary {
  id: string;
  createdAt: string;
  bytes: number;
  files: number;
  title: string;
  restoredFrom: string | null;
  rendering?: string;
}

export interface LiveSource {
  id: string;
  kind: 'file';
  path: string;
  format: 'csv' | 'json' | 'text';
  refresh: 'open';
  maxBytes: number;
}

export interface ArtifactMeta {
  schema: 2;
  id: string;
  title: string;
  kind: ArtifactKind;
  directory: string;
  projectName: string;
  sessionId: string | null;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  currentVersion: string;
  pinnedVersion: string | null;
  librarySet: string;
  libraries: string[];
  versions: VersionSummary[];
  live: LiveSource[];
  openCount: number;
  lastOpenedAt: string | null;
  dedupeKey: string | null;
}

export interface CreateArtifactInput {
  title: string;
  kind: ArtifactKind;
  directory: string;
  files: ArtifactFileInput[];
  entry?: string;
  sessionId?: string | null;
  tags?: string[];
  librarySet?: string;
  libraries?: string[];
  dedupeKey?: string | null;
  live?: LiveSource[];
  now?: Date;
  baseVersion?: string;
}

export interface TextEdit {
  find: string;
  replace: string;
}

export type UpdateInput =
  | { mode: 'metadata'; title?: string; tags?: string[]; baseVersion: string }
  | {
      mode: 'replace';
      files: ArtifactFileInput[];
      entry?: string;
      title?: string;
      tags?: string[];
      baseVersion?: string;
    }
  | {
      mode: 'merge';
      files: ArtifactFileInput[];
      remove?: string[];
      entry?: string;
      title?: string;
      tags?: string[];
      baseVersion: string;
    }
  | {
      mode: 'edits';
      path?: string;
      edits: TextEdit[];
      title?: string;
      tags?: string[];
      baseVersion: string;
    }
  | {
      mode: 'restore';
      restoreFrom: string;
      title?: string;
      tags?: string[];
      baseVersion: string;
    };

export interface CreateResult {
  id: string;
  version: string;
  meta: ArtifactMeta;
  deduped: boolean;
  contentChanged: boolean;
}

export interface UpdateResult {
  id: string;
  version: string;
  changedFiles: string[];
  meta: ArtifactMeta;
}

export interface ReadResult {
  meta: ArtifactMeta;
  version: string;
  manifest: VersionManifest;
}

export interface VersionFile extends ArtifactFileRecord {
  content: Uint8Array;
}

export interface ReadVersionResult extends ReadResult {
  files: VersionFile[];
}

export interface ListFilter {
  directory?: string;
  query?: string;
  kind?: ArtifactKind;
  tag?: string;
  limit?: number;
  includeArchived?: boolean;
  archivedOnly?: boolean;
  offset?: number;
  sort?: 'updated' | 'title';
  trash?: boolean;
}

export interface ArtifactSummary {
  id: string;
  title: string;
  kind: ArtifactKind;
  directory: string;
  projectName: string;
  updatedAt: string;
  versions: number;
  currentVersion: string;
  tags: string[];
  favorite: boolean;
  archived: boolean;
  feedbackCount: number;
  pendingFeedbackCount?: number;
}

export interface ListResult {
  artifacts: ArtifactSummary[];
  errors: number;
  total?: number;
  tags?: string[];
  pendingFeedbackCount?: number;
}
