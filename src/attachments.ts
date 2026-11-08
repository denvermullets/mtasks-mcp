import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, resolve } from "node:path";
import { z } from "zod";
import { apiBaseUrl, apiRequest } from "./api-client.js";

export const filePathsSchema = z
  .array(z.string())
  .optional()
  .describe(
    "Local file paths to attach (absolute, or ~/...). Max 25 MB each; images, PDFs, video, text/markdown/csv/json, zip and Office files. Existing attachments are kept."
  );

// Mirrors ALLOWED_CONTENT_TYPES in the Rails app's
// app/controllers/api/v1/direct_uploads_controller.rb (SVG/HTML are refused there).
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

const MAX_BYTES = 25 * 1024 * 1024;

export interface LocalFile {
  filename: string;
  contentType: string;
  data: Uint8Array<ArrayBuffer>;
}

export interface UploadedFile {
  filename: string;
  signedId: string;
}

// One ActiveStorage attachment as Api::V1::AttachmentSerializer renders it.
// `id` is the attachment id the remove_* tools take.
export interface Attachment {
  id: number;
  filename: string;
  content_type: string;
  byte_size: number;
  download_url: string;
}

interface DirectUpload {
  signed_id: string;
  direct_upload: { url: string; headers: Record<string, string> };
}

function expandPath(path: string): string {
  if (path === "~" || path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  return resolve(path);
}

export function contentTypeFor(filename: string): string | undefined {
  return CONTENT_TYPES[extname(filename).toLowerCase()];
}

// Reads and validates every file up front so a bad path or type fails the
// call before anything is written, rather than leaving a half-done change.
export async function readLocalFiles(paths: string[]): Promise<LocalFile[]> {
  return Promise.all(
    paths.map(async (path) => {
      const fullPath = expandPath(path);
      const info = await stat(fullPath).catch(() => null);
      if (!info?.isFile()) {
        throw new Error(`Attachment not found or not a file: ${path}`);
      }
      const filename = basename(fullPath);
      const contentType = contentTypeFor(filename);
      if (!contentType) {
        throw new Error(
          `Unsupported attachment type: ${filename}. Allowed: ${Object.keys(CONTENT_TYPES).join(" ")}`
        );
      }
      if (info.size === 0 || info.size > MAX_BYTES) {
        throw new Error(`Attachment must be between 1 byte and 25 MB: ${path}`);
      }
      const buffer = await readFile(fullPath);
      return { filename, contentType, data: new Uint8Array(buffer) };
    })
  );
}

// ActiveStorage direct upload: register the blob with the API, PUT the bytes
// to the storage URL it hands back, and return the signed id that the attach
// endpoints take. The storage URL is pre-signed, so no Authorization header.
async function uploadFile(file: LocalFile): Promise<UploadedFile> {
  const checksum = createHash("md5").update(file.data).digest("base64");
  const blob = await apiRequest<DirectUpload>("/api/v1/direct_uploads", {
    method: "POST",
    body: {
      blob: {
        filename: file.filename,
        byte_size: file.data.byteLength,
        checksum,
        content_type: file.contentType,
      },
    },
  });

  const target = new URL(blob.direct_upload.url, apiBaseUrl());
  const response = await fetch(target, {
    method: "PUT",
    headers: blob.direct_upload.headers,
    body: file.data,
  });
  if (!response.ok) {
    throw new Error(
      `Upload of ${file.filename} failed: ${response.status} ${await response.text()}`
    );
  }
  return { filename: file.filename, signedId: blob.signed_id };
}

// Validates every path, then uploads. Uploaded-but-unattached blobs are
// harmless (ActiveStorage purges orphans), so a later failure leaves no mess.
export async function uploadLocalFiles(
  paths: string[] | undefined
): Promise<UploadedFile[]> {
  if (!paths || paths.length === 0) return [];
  const files = await readLocalFiles(paths);
  const uploaded: UploadedFile[] = [];
  for (const file of files) uploaded.push(await uploadFile(file));
  return uploaded;
}

// POST {signed_ids} to an issue's or project's attachments endpoint.
export async function attachUploads(
  path: string,
  uploads: UploadedFile[]
): Promise<Attachment[]> {
  if (uploads.length === 0) return [];
  return apiRequest<Attachment[]>(path, {
    method: "POST",
    body: { signed_ids: uploads.map((u) => u.signedId) },
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatAttachments(attachments: Attachment[]): string {
  return attachments
    .map(
      (a) =>
        `${a.filename} (${a.content_type}, ${formatBytes(a.byte_size)}, attachment ID: ${a.id})`
    )
    .join(", ");
}
