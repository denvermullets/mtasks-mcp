import test from "node:test";
import assert from "node:assert/strict";

import { registerProjectTools } from "../dist/tools/projects.js";
import { registerIssueTools } from "../dist/tools/issues.js";

const tools = new Map();
const server = {
  tool(name, description, schema) {
    tools.set(name, { description, schema });
  },
};
registerProjectTools(server);
registerIssueTools(server);

const desc = (name) => tools.get(name).description;
const argDesc = (name) => tools.get(name).schema.description.description;

test("update_project steers partial description edits to the section tools", () => {
  for (const t of [
    "edit_project_description",
    "replace_project_section",
    "append_to_project_section",
  ]) {
    assert.match(desc("update_project"), new RegExp(t));
  }
});

test("update_issue steers partial description edits to the section tools", () => {
  for (const t of [
    "edit_issue_description",
    "replace_issue_section",
    "append_to_issue_section",
  ]) {
    assert.match(desc("update_issue"), new RegExp(t));
  }
});

test("description argument is for full rewrites or seeding only", () => {
  for (const t of ["update_project", "update_issue"]) {
    assert.match(argDesc(t), /full rewrite/i);
    assert.match(argDesc(t), /seed/i);
  }
});

test("get_project / get_issue point at the section readers", () => {
  assert.match(desc("get_project"), /list_project_sections/);
  assert.match(desc("get_project"), /get_project_section/);
  assert.match(desc("get_issue"), /list_issue_sections/);
  assert.match(desc("get_issue"), /get_issue_section/);
});
