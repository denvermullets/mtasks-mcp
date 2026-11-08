import test from "node:test";
import assert from "node:assert/strict";

import { formatIssue } from "../dist/tools/issues.js";
import { formatHierarchy } from "../dist/tools/sub-issues.js";

function makeIssue(overrides) {
  return {
    id: 10,
    identifier: "AHT-1",
    title: "Root",
    priority: "no_priority",
    estimate: null,
    due_date: null,
    lane: { id: 1, name: "Backlog" },
    assignee: null,
    creator: { id: 1, name: "Tester" },
    project: null,
    labels: [],
    started_at: null,
    completed_at: null,
    canceled_at: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

function node(id, identifier, title, sub_issues = [], extra = {}) {
  return {
    id,
    identifier,
    title,
    priority: "medium",
    lane: { id: 1, name: "Backlog", category: "backlog" },
    assignee: null,
    closed: false,
    sub_issue_count: sub_issues.length,
    sub_issues,
    ...extra,
  };
}

test("detail view lists parent and direct sub-issues with their ids", () => {
  const text = formatIssue(
    makeIssue({
      parent_issue: { id: 9, identifier: "AHT-0" },
      sub_issues: [
        { id: 11, identifier: "AHT-2", title: "Child", lane: { id: 2, name: "Todo" } },
      ],
    }),
    true
  );
  assert.match(text, /Parent: AHT-0 \(ID: 9\)/);
  assert.match(text, /Sub-issues: AHT-2 \(Child\) \[Todo, ID: 11\]/);
});

test("list view shows the parent id carried on every row", () => {
  assert.match(formatIssue(makeIssue({ parent_issue_id: 9 })), /Parent issue ID: 9/);
  assert.doesNotMatch(formatIssue(makeIssue({ parent_issue_id: null })), /Parent/);
});

test("hierarchy renders nested, marks the focus issue, and names blocks", () => {
  const text = formatHierarchy({
    issue_id: 12,
    root_id: 10,
    ancestor_ids: [10, 11],
    truncated: true,
    tree: node(10, "AHT-1", "Root", [
      node(11, "AHT-2", "Child", [
        node(12, "AHT-3", "Grandchild", [], {
          closed: true,
          assignee: { id: 1, name: "Ana" },
        }),
      ]),
    ]),
    blocks: [{ blocking_issue_id: 11, blocked_issue_id: 12 }],
  });

  const lines = text.split("\n");
  assert.equal(lines[0], "- [ ] AHT-1: Root (Backlog | medium | ID: 10)");
  assert.equal(lines[1], "  - [ ] AHT-2: Child (Backlog | medium | ID: 11)");
  assert.equal(
    lines[2],
    "    - [x] AHT-3: Grandchild (Backlog | medium | Ana | ID: 12) ← this issue"
  );
  assert.match(text, /deeper levels omitted/);
  assert.match(text, /AHT-2 blocks AHT-3/);
});
