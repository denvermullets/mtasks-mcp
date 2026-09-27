import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { z } from "zod";

export const filePathsSchema = z
  .array(z.string())
  .optional()
  .describe(
    "Local file paths to attach (absolute, or ~/...). Uploaded to the issue alongside any other changes; existing attachments are kept."
  );

export interface LocalFile {
  filename: string;
  data: Uint8Array<ArrayBuffer>;
}

export interface Attachment {
  id: number;
  filename: string;
  content_type: string;
  byte_size: number;
  url: string;
}

function expandPath(path: string): string {
  if (path === "~" || path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  return resolve(path);
}

// Reads every file up front so a bad path fails the call before anything is
// written, rather than leaving a half-created issue behind.
export async function readLocalFiles(paths: string[]): Promise<LocalFile[]> {
  return Promise.all(
    paths.map(async (path) => {
      const fullPath = expandPath(path);
      const info = await stat(fullPath).catch(() => null);
      if (!info?.isFile()) {
        throw new Error(`Attachment not found or not a file: ${path}`);
      }
      const buffer = await readFile(fullPath);
      return { filename: basename(fullPath), data: new Uint8Array(buffer) };
    })
  );
}

// Encodes { root: fields, files } the way Rails parses multipart params:
// root[key]=value, root[key][]=each array item, root[files][]=each upload.
// An empty array is sent as a single blank item so it still clears the
// association (Rails drops blank ids), matching `label_ids: []` over JSON.
export function buildMultipart(
  root: string,
  fields: Record<string, unknown>,
  files: LocalFile[]
): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) form.append(`${root}[${key}][]`, "");
      for (const item of value) form.append(`${root}[${key}][]`, String(item));
    } else {
      form.append(`${root}[${key}]`, String(value));
    }
  }
  for (const file of files) {
    // Content type is left to the server, which sniffs it from name + bytes.
    form.append(`${root}[files][]`, new Blob([file.data]), file.filename);
  }
  return form;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatAttachments(attachments: Attachment[]): string {
  return attachments
    .map((a) => `${a.filename} (${a.content_type}, ${formatBytes(a.byte_size)})`)
    .join(", ");
}
