import test from "node:test";
import assert from "node:assert/strict";

import {
  AmbiguousMatch,
  DuplicateHeading,
  EmptyOldString,
  SectionError,
  SectionNotFound,
  TextNotFound,
  appendToSection,
  getSection,
  listSections,
  replaceSection,
  replaceText,
} from "../dist/description-sections.js";

const DOC = [
  "Preamble line.",
  "",
  "## What",
  "Build it.",
  "",
  "## API",
  "Intro.",
  "### listSections",
  "Lists.",
  "### getSection",
  "Gets.",
  "",
  "## Why",
  "Because.",
  "",
].join("\n");

test("listSections returns headings with levels in order, skipping h1", () => {
  assert.deepEqual(listSections("# Title\n## A\n### B\n## C\n"), [
    { heading: "A", level: 2 },
    { heading: "B", level: 3 },
    { heading: "C", level: 2 },
  ]);
});

test("listSections ignores heading-like lines inside code fences", () => {
  const d = "## Real\n```md\n## Fake\n```\n~~~\n## Fake2\n~~~\n## Real2\n";
  assert.deepEqual(
    listSections(d).map((s) => s.heading),
    ["Real", "Real2"]
  );
});

test("listSections returns [] when there are no headings", () => {
  assert.deepEqual(listSections("just text\n"), []);
});

test("getSection returns the body without the heading, including subsections", () => {
  assert.equal(
    getSection(DOC, { heading: "API" }),
    "Intro.\n### listSections\nLists.\n### getSection\nGets.\n\n"
  );
});

test("getSection on a subsection stops at the next equal-or-higher heading", () => {
  assert.equal(getSection(DOC, { heading: "listSections" }), "Lists.\n");
});

test("getSection throws SectionNotFound listing available headings", () => {
  assert.throws(
    () => getSection(DOC, { heading: "Nope" }),
    (e) =>
      e instanceof SectionNotFound &&
      e.name === "SectionNotFound" &&
      /What/.test(e.message) &&
      /listSections/.test(e.message)
  );
});

test("duplicate headings throw DuplicateHeading naming the heading", () => {
  const d = "## A\nx\n## A\ny\n";
  assert.throws(
    () => getSection(d, { heading: "A" }),
    (e) => e instanceof DuplicateHeading && /A/.test(e.message)
  );
  assert.throws(() => replaceSection(d, { heading: "A", body: "z" }), DuplicateHeading);
  assert.throws(() => appendToSection(d, { heading: "A", text: "z" }), DuplicateHeading);
});

test("heading match is exact on trimmed heading text", () => {
  const d = "##   Spaced   \nx\n";
  assert.equal(getSection(d, { heading: "Spaced" }), "x\n");
  assert.throws(() => getSection(d, { heading: "spaced" }), SectionNotFound);
});

test("replaceSection swaps the body, keeps heading, preamble and neighbours", () => {
  const out = replaceSection(DOC, { heading: "What", body: "Changed." });
  assert.equal(
    out,
    DOC.replace("## What\nBuild it.\n\n", "## What\nChanged.\n\n")
  );
  assert.ok(out.startsWith("Preamble line.\n\n## What\n"));
});

test("replaceSection on a parent replaces its subsections too", () => {
  const out = replaceSection(DOC, { heading: "API", body: "Only this." });
  assert.equal(
    out,
    "Preamble line.\n\n## What\nBuild it.\n\n## API\nOnly this.\n\n## Why\nBecause.\n"
  );
});

test("replaceSection on a subsection leaves the parent and siblings intact", () => {
  const out = replaceSection(DOC, { heading: "listSections", body: "New." });
  assert.equal(
    out,
    DOC.replace("### listSections\nLists.\n", "### listSections\nNew.\n")
  );
});

test("replaceSection round-trips getSection output unchanged", () => {
  const body = getSection(DOC, { heading: "API" });
  assert.equal(replaceSection(DOC, { heading: "API", body }), DOC);
});

test("replaceSection preserves absence and presence of trailing newline", () => {
  assert.equal(
    replaceSection("## A\nold", { heading: "A", body: "new\n" }),
    "## A\nnew"
  );
  assert.equal(
    replaceSection("## A\nold\n", { heading: "A", body: "new" }),
    "## A\nnew\n"
  );
  assert.equal(
    replaceSection("## A", { heading: "A", body: "new" }),
    "## A\nnew"
  );
});

test("replaceSection keeps a newline between body and the next heading", () => {
  assert.equal(
    replaceSection("## A\nold\n## B\nx\n", { heading: "A", body: "new" }),
    "## A\nnew\n## B\nx\n"
  );
});

test("replaceSection preserves CRLF line endings", () => {
  const d = "## A\r\nold\r\n## B\r\nx\r\n";
  assert.equal(
    replaceSection(d, { heading: "A", body: "new" }),
    "## A\r\nnew\r\n## B\r\nx\r\n"
  );
});

test("replaceSection ignores headings inside code fences when finding the end", () => {
  const d = "## A\n```\n## B\n```\n## C\nx\n";
  assert.equal(
    replaceSection(d, { heading: "A", body: "z" }),
    "## A\nz\n## C\nx\n"
  );
  assert.throws(() => getSection(d, { heading: "B" }), SectionNotFound);
});

test("replaceSection throws SectionNotFound for a missing heading", () => {
  assert.throws(
    () => replaceSection(DOC, { heading: "Missing", body: "x" }),
    SectionNotFound
  );
});

test("appendToSection adds text at the end of the section, before trailing blank lines", () => {
  assert.equal(
    appendToSection(DOC, { heading: "What", text: "More." }),
    DOC.replace("Build it.\n\n", "Build it.\nMore.\n\n")
  );
});

test("appendToSection on a parent lands after its last subsection", () => {
  const out = appendToSection(DOC, { heading: "API", text: "Tail." });
  assert.ok(out.includes("Gets.\nTail.\n\n## Why"));
});

test("appendToSection on an empty section and without trailing newline", () => {
  assert.equal(
    appendToSection("## A\n## B\n", { heading: "A", text: "x" }),
    "## A\nx\n## B\n"
  );
  assert.equal(
    appendToSection("## A\nold", { heading: "A", text: "new" }),
    "## A\nold\nnew"
  );
});

test("appendToSection throws SectionNotFound for a missing heading", () => {
  assert.throws(
    () => appendToSection(DOC, { heading: "Missing", text: "x" }),
    SectionNotFound
  );
});

test("replaceText replaces a single match", () => {
  assert.equal(
    replaceText("a foo b", { oldString: "foo", newString: "bar" }),
    "a bar b"
  );
});

test("replaceText treats $ patterns in newString literally", () => {
  assert.equal(
    replaceText("a foo", { oldString: "foo", newString: "$& $1" }),
    "a $& $1"
  );
});

test("replaceText throws TextNotFound on zero matches", () => {
  assert.throws(
    () => replaceText("abc", { oldString: "zzz", newString: "x" }),
    (e) => e instanceof TextNotFound && e.name === "TextNotFound" && /0/.test(e.message)
  );
});

test("replaceText throws AmbiguousMatch on multiple matches with the count", () => {
  assert.throws(
    () => replaceText("foo foo foo", { oldString: "foo", newString: "x" }),
    (e) => e instanceof AmbiguousMatch && e.name === "AmbiguousMatch" && /3/.test(e.message)
  );
});

test("replaceText replaceAll replaces every match", () => {
  assert.equal(
    replaceText("foo foo", { oldString: "foo", newString: "x", replaceAll: true }),
    "x x"
  );
  assert.throws(
    () => replaceText("abc", { oldString: "zzz", newString: "x", replaceAll: true }),
    TextNotFound
  );
});

test("replaceText rejects an empty oldString", () => {
  assert.throws(
    () => replaceText("abc", { oldString: "", newString: "x" }),
    (err) => err instanceof EmptyOldString && /empty/.test(err.message)
  );
});

test("all splicer errors share the SectionError base class", () => {
  const errs = [
    () => getSection("## A\n", { heading: "B" }),
    () => getSection("## A\n## A\n", { heading: "A" }),
    () => replaceText("a", { oldString: "z", newString: "" }),
    () => replaceText("aa", { oldString: "a", newString: "" }),
    () => replaceText("a", { oldString: "", newString: "" }),
  ];
  for (const fn of errs) {
    assert.throws(fn, (err) => err instanceof SectionError && err instanceof Error);
  }
  assert.ok(new SectionNotFound("x", []) instanceof SectionError);
  assert.ok(new DuplicateHeading("x", 2) instanceof SectionError);
  assert.ok(new TextNotFound() instanceof SectionError);
  assert.ok(new AmbiguousMatch(2) instanceof SectionError);
});

test("optional closing # sequence is stripped from headings", () => {
  const doc = "## Goals ##\nA\n\n### Sub ###   \nB\n\n## C#\nC\n";
  assert.deepEqual(listSections(doc), [
    { heading: "Goals", level: 2 },
    { heading: "Sub", level: 3 },
    { heading: "C#", level: 2 },
  ]);
  assert.equal(getSection(doc, { heading: "Goals" }), "A\n\n### Sub ###   \nB\n\n");
});
