import { z } from 'zod';

export const fileSchema = z.object({
  path: z.string().min(1).max(512),
  content: z.string().max(5 * 1024 * 1024).optional(),
  contentBase64: z.string().max(7 * 1024 * 1024).optional(),
});

export const schemas = {
  publish: z.object({
    title: z.string().min(1).max(200),
    kind: z.enum(['html', 'bundle']).optional(),
    html: z.string().min(1).max(2 * 1024 * 1024).optional(),
    files: z.array(fileSchema).min(1).max(200).optional(),
    entry: z.string().min(1).max(512).optional(),
    filePath: z.string().min(1).max(4096).optional(),
    directoryPath: z.string().min(1).max(4096).optional(),
    directory: z.string().min(1).max(4096).optional(),
    tags: z.array(z.string().min(1).max(32)).max(16).optional(),
    libraries: z.array(z.string().regex(/^[a-z0-9-]{1,32}$/)).max(16).optional(),
    dedupeKey: z.string().min(1).max(200).optional(),
    baseVersion: z.string().min(1).optional(),
  }),
  update: z.object({
    id: z.string().min(1),
    baseVersion: z.string().min(1),
    mode: z.enum(['merge', 'replace']).optional(),
    html: z.string().min(1).max(2 * 1024 * 1024).optional(),
    files: z.array(fileSchema).max(200).optional(),
    entry: z.string().min(1).max(512).optional(),
    filePath: z.string().min(1).max(4096).optional(),
    directoryPath: z.string().min(1).max(4096).optional(),
    directory: z.string().min(1).max(4096).optional(),
    remove: z.array(z.string().min(1).max(512)).max(200).optional(),
    edits: z.array(z.object({ find: z.string().min(1).max(4096), replace: z.string().max(65536) })).min(1).max(20).optional(),
    path: z.string().min(1).max(512).optional(),
    restoreFrom: z.string().min(1).optional(),
    title: z.string().min(1).max(200).optional(),
    tags: z.array(z.string().min(1).max(32)).max(16).optional(),
  }),
  list: z.object({
    directory: z.string().min(1).max(4096).optional(),
    query: z.string().max(200).optional(),
    kind: z.enum(['html', 'bundle', 'markdown', 'image', 'pdf', 'data']).optional(),
    tag: z.string().max(32).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    includeArchived: z.boolean().optional(),
    allProjects: z.boolean().optional(),
    offset: z.number().int().min(0).optional(),
    sort: z.enum(['updated', 'title']).optional(),
  }),
  read: z.object({
    id: z.string().min(1),
    version: z.string().min(1).optional(),
    includeFiles: z.boolean().optional(),
    path: z.string().min(1).max(512).optional(),
  }),
  archive: z.object({ id: z.string().min(1) }),
  result: z.object({
    id: z.string().min(1),
    since: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  }),
};

export type OperationName = keyof typeof schemas;
