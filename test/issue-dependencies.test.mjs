import test from "node:test";
import assert from "node:assert/strict";

import { formatIssue } from "../dist/tools/issues.js";

// Round-trip guard for the create_issue_dependency <-> get_issue direction.
//
// This encodes the contract shared with the Rails backend so that a regression
// at either end (the write-path mapping or the get_issue label rendering) fails
// here instead of silently inverting every dependency.

// Mirrors app/controllers/api/v1/issue_dependencies_controller.rb#create:
//   direction 'blocked_by' => the SOURCE issue is blocked by the TARGET
//   direction 'blocking'   => the SOURCE issue blocks the TARGET
function storeDependency(source, target, direction) {
  return direction === "blocked_by"
    ? { blocking_issue: target, blocked_issue: source }
    : { blocking_issue: source, blocked_issue: target };
}

// Mirrors app/models/issue.rb associations as rendered by the issue serializer:
//   blocking_issues = issues that block this issue (this issue is blocked_by them)
//   blocked_issues  = issues this issue blocks (this issue is blocking them)
function serializeIssue(issue, deps) {
  return makeIssue({
    ...issue,
    blocking_issues: deps
      .filter((d) => d.blocked_issue.id === issue.id)
      .map((d) => d.blocking_issue),
    blocked_issues: deps
      .filter((d) => d.blocking_issue.id === issue.id)
      .map((d) => d.blocked_issue),
  });
}

function makeIssue(overrides) {
  return {
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

const DGHD_34 = { id: 1898, identifier: "DGHD-34", title: "Crafting queue" };
const DGHD_41 = { id: 1905, identifier: "DGHD-41", title: "Day/time cycle" };

test("direction 'blocked_by': source is blocked by target", () => {
  // Intent: DGHD-34 is blocked by DGHD-41 (DGHD-41 must finish first).
  const dep = storeDependency(DGHD_34, DGHD_41, "blocked_by");
  const deps = [dep];

  const source = formatIssue(serializeIssue(DGHD_34, deps), true);
  const target = formatIssue(serializeIssue(DGHD_41, deps), true);

  assert.match(source, /Blocked by: DGHD-41/);
  assert.doesNotMatch(source, /Blocking: DGHD-41/);

  assert.match(target, /Blocking: DGHD-34/);
  assert.doesNotMatch(target, /Blocked by: DGHD-34/);
});

test("direction 'blocking': source blocks target", () => {
  // Intent: DGHD-34 blocks DGHD-41 (DGHD-34 must finish first).
  const dep = storeDependency(DGHD_34, DGHD_41, "blocking");
  const deps = [dep];

  const source = formatIssue(serializeIssue(DGHD_34, deps), true);
  const target = formatIssue(serializeIssue(DGHD_41, deps), true);

  assert.match(source, /Blocking: DGHD-41/);
  assert.doesNotMatch(source, /Blocked by: DGHD-41/);

  assert.match(target, /Blocked by: DGHD-34/);
  assert.doesNotMatch(target, /Blocking: DGHD-34/);
});
