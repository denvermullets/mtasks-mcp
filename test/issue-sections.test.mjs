import test from "node:test";
import assert from "node:assert/strict";

import { registerIssueTools } from "../dist/tools/issues.js";

const realFetch = globalThis.fetch;
process.env.MTASKS_API_TOKEN = "test-token";
process.env.MTASKS_API_URL = "https://example.test";

const tools = {};
registerIssueTools({
  tool: (name, description, _schema, handler) => {
    tools[name] = { description, handler };
  },
});

const DOC = "## What\nBuild it.\n\n## Why\nBecause.\n";
const PATH = "/api/v1/teams/4/issues/939";

// Stubs fetch: GET returns the description, PATCH stores the sent one.
function stubIssue(description) {
  const state = { description, calls: [] };
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    state.calls.push({ method, path: new URL(url).pathname, body });
    if (method === "PATCH") state.description = body.issue.description;
    return new Response(
      JSON.stringify({ id: 939, identifier: "JAIT-142", title: "T", description: state.description }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  return state;
}
test.after(() => {
  globalThis.fetch = realFetch;
});

const run = async (name, args) =>
  (await tools[name].handler(args)).content[0].text;

test("registers the five section tools, steering away from update_issue", () => {
  for (const n of [
    "list_issue_sections",
    "get_issue_section",
    "replace_issue_section",
    "append_to_issue_section",
    "edit_issue_description",
  ]) {
    assert.ok(tools[n], n);
  }
  assert.match(tools.replace_issue_section.description, /update_issue/);
});

test("list_issue_sections lists headings with levels", async () => {
  stubIssue("## A\n### B\n");
  const text = await run("list_issue_sections", { team_id: 4, issue_id: 939 });
  assert.match(text, /A \(h2\)/);
  assert.match(text, /B \(h3\)/);
});

test("get_issue_section returns the body and never writes", async () => {
  const s = stubIssue(DOC);
  const text = await run("get_issue_section", { team_id: 4, issue_id: 939, heading: "What" });
  assert.match(text, /Build it\./);
  assert.deepEqual(s.calls.map((c) => c.method), ["GET"]);
});

test("replace_issue_section PATCHes the spliced description and confirms briefly", async () => {
  const s = stubIssue(DOC);
  const text = await run("replace_issue_section", {
    team_id: 4, issue_id: 939, heading: "What", body: "New.",
  });
  assert.equal(s.description, "## What\nNew.\n\n## Why\nBecause.\n");
  assert.equal(s.calls[1].path, PATH);
  assert.match(text, /JAIT-142/);
  assert.doesNotMatch(text, /Because/);
});

test("append_to_issue_section appends at the end of the section", async () => {
  const s = stubIssue(DOC);
  await run("append_to_issue_section", { team_id: 4, issue_id: 939, heading: "What", text: "More." });
  assert.equal(s.description, "## What\nBuild it.\nMore.\n\n## Why\nBecause.\n");
});

test("edit_issue_description replaces text, honoring replace_all", async () => {
  const s = stubIssue("a a\n");
  const err = await run("edit_issue_description", {
    team_id: 4, issue_id: 939, old_string: "a", new_string: "b",
  });
  assert.match(err, /^Error: .*2 matches/);
  assert.equal(s.calls.length, 1); // no PATCH on failure
  await run("edit_issue_description", {
    team_id: 4, issue_id: 939, old_string: "a", new_string: "b", replace_all: true,
  });
  assert.equal(s.description, "b b\n");
});

test("missing section yields readable error listing headings, without PATCH", async () => {
  const s = stubIssue(DOC);
  const text = await run("replace_issue_section", {
    team_id: 4, issue_id: 939, heading: "Nope", body: "x",
  });
  assert.match(text, /^Error: Section "Nope" not found\. Available headings: "What", "Why"/);
  assert.deepEqual(s.calls.map((c) => c.method), ["GET"]);
});

test("issue without a description is treated as empty", async () => {
  const s = stubIssue(undefined);
  const text = await run("get_issue_section", { team_id: 4, issue_id: 939, heading: "X" });
  assert.match(text, /not found.*\(none\)/);
  assert.equal(s.calls.length, 1);
});
