import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  attachUploads,
  contentTypeFor,
  formatAttachments,
  readLocalFiles,
  uploadLocalFiles,
} from "../dist/attachments.js";

function tempFile(name, contents) {
  const dir = mkdtempSync(join(tmpdir(), "jait-attach-"));
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

// Plays both the Rails API and the storage service the direct upload PUTs to.
async function withFakeServer(fn) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/v1/direct_uploads") {
        const { blob } = JSON.parse(body.toString());
        res.end(
          JSON.stringify({
            signed_id: `signed-${blob.filename}`,
            // Relative, as the Disk service can return; S3 returns absolute.
            direct_upload: {
              url: `/storage/${blob.filename}`,
              headers: { "Content-Type": blob.content_type, "Content-MD5": blob.checksum },
            },
          })
        );
      } else if (req.url.startsWith("/storage/")) {
        res.statusCode = 204;
        res.end();
      } else {
        const { signed_ids } = JSON.parse(body.toString());
        res.statusCode = 201;
        res.end(
          JSON.stringify(
            signed_ids.map((id, i) => ({
              id: 100 + i,
              filename: id.replace("signed-", ""),
              content_type: "image/png",
              byte_size: 8,
              download_url: `/api/v1/attachments/${100 + i}/download`,
            }))
          )
        );
      }
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.MTASKS_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.MTASKS_API_TOKEN = "test-token";
  try {
    return await fn(requests);
  } finally {
    server.close();
  }
}

test("readLocalFiles reads name, bytes and content type", async () => {
  const path = tempFile("design.PNG", "fake-png");
  const [file] = await readLocalFiles([path]);

  assert.equal(file.filename, "design.PNG");
  assert.equal(file.contentType, "image/png");
  assert.equal(Buffer.from(file.data).toString(), "fake-png");
});

test("readLocalFiles rejects a missing path, a directory, an empty file or a disallowed type", async () => {
  await assert.rejects(readLocalFiles(["/no/such/file.png"]), /not found/);
  await assert.rejects(readLocalFiles([tmpdir()]), /not a file/);
  await assert.rejects(readLocalFiles([tempFile("empty.png", "")]), /between 1 byte/);
  await assert.rejects(readLocalFiles([tempFile("x.svg", "<svg/>")]), /Unsupported/);
});

test("contentTypeFor matches the Rails allowlist and refuses svg/html", () => {
  assert.equal(contentTypeFor("notes.md"), "text/markdown");
  assert.equal(contentTypeFor("clip.mov"), "video/quicktime");
  assert.equal(contentTypeFor("page.html"), undefined);
  assert.equal(contentTypeFor("logo.svg"), undefined);
});

test("uploadLocalFiles registers the blob, PUTs the bytes, and returns the signed id", async () => {
  const path = tempFile("shot.png", "pngbytes");

  const { uploads, requests } = await withFakeServer(async (requests) => ({
    uploads: await uploadLocalFiles([path]),
    requests,
  }));

  assert.deepEqual(uploads, [{ filename: "shot.png", signedId: "signed-shot.png" }]);

  const [register, put] = requests;
  assert.equal(register.headers.authorization, "Bearer test-token");
  assert.deepEqual(JSON.parse(register.body.toString()).blob, {
    filename: "shot.png",
    byte_size: 8,
    checksum: createHash("md5").update("pngbytes").digest("base64"),
    content_type: "image/png",
  });

  assert.equal(put.method, "PUT");
  assert.equal(put.url, "/storage/shot.png");
  assert.equal(put.body.toString(), "pngbytes");
  assert.equal(put.headers["content-md5"], createHash("md5").update("pngbytes").digest("base64"));
  // The storage URL is pre-signed; the API token must not leak to it.
  assert.equal(put.headers.authorization, undefined);
});

test("uploadLocalFiles validates every file before uploading any", async () => {
  const good = tempFile("ok.png", "bytes");
  const requests = await withFakeServer(async (requests) => {
    await assert.rejects(uploadLocalFiles([good, "/no/such/file.png"]), /not found/);
    return requests;
  });
  assert.equal(requests.length, 0);
});

test("attachUploads posts signed_ids and formatAttachments shows attachment ids", async () => {
  const { attached, requests } = await withFakeServer(async (requests) => ({
    attached: await attachUploads("/api/v1/teams/1/issues/2/attachments", [
      { filename: "a.png", signedId: "signed-a.png" },
    ]),
    requests,
  }));

  assert.equal(requests[0].url, "/api/v1/teams/1/issues/2/attachments");
  assert.deepEqual(JSON.parse(requests[0].body.toString()), { signed_ids: ["signed-a.png"] });
  assert.equal(formatAttachments(attached), "a.png (image/png, 8 B, attachment ID: 100)");
});

test("attachUploads makes no request when nothing was uploaded", async () => {
  assert.deepEqual(await attachUploads("/never/called", []), []);
});
