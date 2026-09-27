import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildMultipart, readLocalFiles } from "../dist/attachments.js";
import { apiRequest } from "../dist/api-client.js";

function tempFile(name, contents) {
  const dir = mkdtempSync(join(tmpdir(), "jait-attach-"));
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

test("readLocalFiles reads name and bytes", async () => {
  const path = tempFile("design.png", "fake-png");
  const [file] = await readLocalFiles([path]);

  assert.equal(file.filename, "design.png");
  assert.equal(Buffer.from(file.data).toString(), "fake-png");
});

test("readLocalFiles rejects a missing path or a directory", async () => {
  await assert.rejects(readLocalFiles(["/no/such/file.png"]), /not found/);
  await assert.rejects(readLocalFiles([tmpdir()]), /not a file/);
});

test("buildMultipart uses Rails nested param names", async () => {
  const form = buildMultipart(
    "issue",
    { title: "Shots", lane_id: 3, label_ids: [1, 2], assignee_id: undefined },
    [{ filename: "a.png", data: new Uint8Array([1, 2, 3]) }]
  );

  assert.equal(form.get("issue[title]"), "Shots");
  assert.equal(form.get("issue[lane_id]"), "3");
  assert.deepEqual(form.getAll("issue[label_ids][]"), ["1", "2"]);
  assert.equal(form.has("issue[assignee_id]"), false);

  const [upload] = form.getAll("issue[files][]");
  assert.equal(upload.name, "a.png");
  assert.equal(upload.size, 3);
});

test("buildMultipart sends an empty array as one blank item", () => {
  const form = buildMultipart("issue", { label_ids: [] }, []);
  assert.deepEqual(form.getAll("issue[label_ids][]"), [""]);
});

test("apiRequest sends a form as multipart with a boundary", async () => {
  let received;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received = { headers: req.headers, body: Buffer.concat(chunks) };
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.MTASKS_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.MTASKS_API_TOKEN = "test-token";

  try {
    const form = buildMultipart("comment", { body: "see attached" }, [
      { filename: "shot.png", data: new Uint8Array(Buffer.from("pngbytes")) },
    ]);
    await apiRequest("/api/v1/teams/1/issues/2/comments", { method: "POST", form });
  } finally {
    server.close();
  }

  assert.match(received.headers["content-type"], /^multipart\/form-data; boundary=/);
  assert.equal(received.headers.authorization, "Bearer test-token");

  // Parse it back the way a server would to prove the encoding round-trips.
  const parsed = await new Response(received.body, {
    headers: { "content-type": received.headers["content-type"] },
  }).formData();
  assert.equal(parsed.get("comment[body]"), "see attached");
  const upload = parsed.get("comment[files][]");
  assert.equal(upload.name, "shot.png");
  assert.equal(await upload.text(), "pngbytes");
});
