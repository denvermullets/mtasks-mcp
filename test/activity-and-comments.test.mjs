import test from "node:test";
import assert from "node:assert/strict";

import { formatActivityEntry, formatActivityPage } from "../dist/tools/issues.js";
import { formatComment } from "../dist/tools/comments.js";

test("version entries render actor, description and resolved changes", () => {
  const text = formatActivityEntry({
    type: "version",
    id: 1,
    cursor: "version:1",
    created_at: "2026-11-01T10:00:00Z",
    actor: { id: 1, name: "Ana" },
    description: "changed status",
    changes: [
      { field: "lane_id", from: { id: 1, name: "Backlog" }, to: { id: 2, name: "Done" } },
      { field: "estimate", from: null, to: 3 },
    ],
  });
  assert.equal(
    text,
    "2026-11-01T10:00:00Z — Ana changed status (lane_id: Backlog → Done; estimate: none → 3)"
  );
});

test("comment and reference entries render their own shapes", () => {
  assert.match(
    formatActivityEntry({
      type: "comment",
      id: 5,
      cursor: "comment:5",
      created_at: "t",
      comment: { id: 5, body: "lgtm", user: { name: "Bo" } },
    }),
    /Bo commented \(#5\): lgtm/
  );
  assert.match(
    formatActivityEntry({
      type: "reference",
      id: 6,
      cursor: "reference:6",
      created_at: "t",
      user: { id: 1, name: "Cy" },
      source_issue: { identifier: "AHT-9", title: "Other" },
      source_type: "comment",
    }),
    /Cy referenced this from AHT-9 \(Other\) in a comment/
  );
});

test("activity page surfaces the next-page cursor", () => {
  assert.equal(formatActivityPage([], null), "No activity found.");
  const page = formatActivityPage(
    [{ type: "version", id: 1, cursor: "version:1", created_at: "t", description: "x" }],
    "version:1"
  );
  assert.match(page, /before_id "version:1"/);
});

test("comments render attachments from the `files` key, and team-feed owners", () => {
  const text = formatComment({
    id: 7,
    body: "see shot",
    parent_id: null,
    user: { id: 1, name: "Ana", email: "a@example.com" },
    files: [
      { id: 42, filename: "s.png", content_type: "image/png", byte_size: 2048, download_url: "/x" },
    ],
    created_at: "t",
    updated_at: "t",
    owner_type: "Project",
    owner_id: 3,
  });
  assert.match(text, /#7 by Ana on project 3/);
  assert.match(text, /s\.png \(image\/png, 2\.0 KB, attachment ID: 42\)/);
});
