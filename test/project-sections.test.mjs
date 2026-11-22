import test from "node:test";
import assert from "node:assert/strict";

import { registerProjectTools } from "../dist/tools/projects.js";

const realFetch = globalThis.fetch;

const tools = new Map();
registerProjectTools({
  tool(name, description, schema, handler) {
    tools.set(name, { description, schema, handler });
  },
});

const DESC = "Intro\n\n## Goals\n\nShip it\n\n## Notes\n\nOne\n";

// Stubs fetch with a project whose description is `description`; PATCHes are
// recorded and applied to the stored description.
function stub(description) {
  process.env.MTASKS_API_TOKEN = "t";
  process.env.MTASKS_API_URL = "https://example.test";
  const calls = [];
  const project = { id: 7, name: "P", description };
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    if (method === "PATCH") project.description = body.project.description;
    return new Response(JSON.stringify(project), { status: 200 });
  };
  return { calls, project };
}

const run = (name, args) => tools.get(name).handler({ team_id: 4, project_id: 7, ...args });
const text = (r) => r.content[0].text;

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test("registers the five section tools", () => {
  for (const n of [
    "list_project_sections",
    "get_project_section",
    "replace_project_section",
    "append_to_project_section",
    "edit_project_description",
  ]) {
    assert.ok(tools.has(n), n);
  }
});

test("list_project_sections shows headings with levels", async () => {
  stub(DESC);
  const r = await run("list_project_sections", {});
  assert.equal(text(r), "## Goals\n## Notes");
});

test("list_project_sections handles empty description", async () => {
  stub(null);
  assert.match(text(await run("list_project_sections", {})), /No sections/);
});

test("get_project_section reports an empty section as (empty section)", async () => {
  stub("## A\n## B\nx\n");
  assert.equal(text(await run("get_project_section", { heading: "A" })), "(empty section)");
});

test("empty old_string is an isError result and does not save", async () => {
  const { calls } = stub(DESC);
  const r = await run("edit_project_description", { old_string: "", new_string: "x" });
  assert.equal(r.isError, true);
  assert.equal(text(r), "oldString must not be empty");
  assert.ok(!calls.some((c) => c.method === "PATCH"));
});

test("non-splicer errors still throw", async () => {
  globalThis.fetch = async () => new Response("boom", { status: 500 });
  await assert.rejects(run("get_project_section", { heading: "A" }), /API error 500/);
});

test("get_project_section returns the section body", async () => {
  stub(DESC);
  assert.match(text(await run("get_project_section", { heading: "Goals" })), /Ship it/);
});

test("replace_project_section PATCHes and confirms without echoing the description", async () => {
  const { calls, project } = stub(DESC);
  const r = await run("replace_project_section", { heading: "Goals", body: "New" });
  assert.equal(project.description, "Intro\n\n## Goals\nNew\n\n## Notes\n\nOne\n");
  const patch = calls.find((c) => c.method === "PATCH");
  assert.equal(patch.url, "https://example.test/api/v1/teams/4/projects/7");
  assert.equal(text(r), 'Replaced section "Goals" in project "P".');
  assert.notEqual(r.isError, true);
});

test("append_to_project_section appends and saves", async () => {
  const { project } = stub(DESC);
  const r = await run("append_to_project_section", { heading: "Notes", text: "Two" });
  assert.match(project.description, /One\nTwo\n$/);
  assert.equal(text(r), 'Appended to section "Notes" in project "P".');
});

test("edit_project_description replaces text, with replace_all", async () => {
  const { project } = stub("a x\n\n## H\n\nx\n");
  await run("edit_project_description", { old_string: "x", new_string: "y", replace_all: true });
  assert.equal(project.description, "a y\n\n## H\n\ny\n");
});

test("missing section is a readable error listing headings and does not save", async () => {
  const { calls } = stub(DESC);
  const r = await run("replace_project_section", { heading: "Nope", body: "x" });
  assert.equal(r.isError, true);
  assert.match(text(r), /"Goals", "Notes"/);
  assert.ok(!calls.some((c) => c.method === "PATCH"));
});

test("ambiguous edit reports the match count and does not save", async () => {
  const { calls } = stub("x x x");
  const r = await run("edit_project_description", { old_string: "x", new_string: "y" });
  assert.equal(r.isError, true);
  assert.match(text(r), /3 matches/);
  assert.ok(!calls.some((c) => c.method === "PATCH"));
});

test("duplicate heading and zero-match errors are readable", async () => {
  stub("## A\n\n1\n\n## A\n\n2\n");
  const dup = await run("get_project_section", { heading: "A" });
  assert.equal(dup.isError, true);
  assert.match(text(dup), /2 times/);
  const none = await run("edit_project_description", { old_string: "zzz", new_string: "y" });
  assert.match(text(none), /0 matches/);
});

test("null description is treated as empty", async () => {
  stub(null);
  const r = await run("get_project_section", { heading: "Goals" });
  assert.equal(r.isError, true);
  assert.match(text(r), /\(none\)/);
});

test("descriptions steer away from update_project", () => {
  for (const n of [
    "replace_project_section",
    "append_to_project_section",
    "edit_project_description",
  ]) {
    assert.match(tools.get(n).description, /update_project/);
  }
});
