// Pure string-in, string-out helpers for reading and editing a markdown
// description by section. No API or MCP SDK imports on purpose.

export interface SectionInfo {
  heading: string;
  level: number;
}

/** Base class for every expected splicing failure (bad heading, bad match). */
export class SectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SectionError";
  }
}

export class SectionNotFound extends SectionError {
  constructor(heading: string, available: string[]) {
    super(
      `Section "${heading}" not found. Available headings: ${
        available.length ? available.map((h) => `"${h}"`).join(", ") : "(none)"
      }`
    );
    this.name = "SectionNotFound";
  }
}

export class DuplicateHeading extends SectionError {
  constructor(heading: string, count: number) {
    super(
      `Heading "${heading}" is ambiguous: it appears ${count} times in the description`
    );
    this.name = "DuplicateHeading";
  }
}

export class TextNotFound extends SectionError {
  constructor() {
    super("Text not found: found 0 matches for oldString");
    this.name = "TextNotFound";
  }
}

export class AmbiguousMatch extends SectionError {
  constructor(count: number) {
    super(
      `Ambiguous match: found ${count} matches for oldString; add surrounding context to make it unique or pass replaceAll`
    );
    this.name = "AmbiguousMatch";
  }
}

export class EmptyOldString extends SectionError {
  constructor() {
    super("oldString must not be empty");
    this.name = "EmptyOldString";
  }
}

interface Line {
  text: string; // without line ending
  eol: string; // "\r\n", "\n" or ""
}

interface Parsed {
  lines: Line[];
  // index into lines of each heading, plus its info
  headings: { index: number; heading: string; level: number }[];
}

const HEADING_RE = /^(#{2,6})\s+(.+)$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

function parse(description: string): Parsed {
  const lines: Line[] = [];
  const re = /([^\r\n]*)(\r\n|\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(description)) !== null) {
    if (m[0] === "") break;
    lines.push({ text: m[1], eol: m[2] });
  }

  const headings: Parsed["headings"] = [];
  let fence: string | null = null;
  lines.forEach((line, index) => {
    const f = FENCE_RE.exec(line.text);
    if (fence) {
      if (
        f &&
        f[1][0] === fence[0] &&
        f[1].length >= fence.length &&
        line.text.trim() === f[1]
      ) {
        fence = null;
      }
      return;
    }
    if (f) {
      fence = f[1];
      return;
    }
    const h = HEADING_RE.exec(line.text);
    if (!h) return;
    // CommonMark: an optional closing sequence of #s (preceded by whitespace)
    // is not part of the heading text.
    const heading = h[2]
      .replace(/(?:^|\s+)#+\s*$/, "")
      .trim();
    if (heading) headings.push({ index, heading, level: h[1].length });
  });
  return { lines, headings };
}

interface Located {
  head: Line;
  body: string;
  before: string; // everything up to and including the heading line
  after: string; // everything from the next boundary on
  hasAfter: boolean;
  eol: string; // line ending to use for inserted breaks
}

function locate(description: string, heading: string): Located {
  const { lines, headings } = parse(description);
  const matches = headings.filter((h) => h.heading === heading);
  if (matches.length === 0) {
    throw new SectionNotFound(
      heading,
      headings.map((h) => h.heading)
    );
  }
  if (matches.length > 1) throw new DuplicateHeading(heading, matches.length);

  const target = matches[0];
  const next = headings.find(
    (h) => h.index > target.index && h.level <= target.level
  );
  const end = next ? next.index : lines.length;
  const join = (from: number, to: number) =>
    lines
      .slice(from, to)
      .map((l) => l.text + l.eol)
      .join("");
  const eol = lines.find((l) => l.eol)?.eol || "\n";
  return {
    head: lines[target.index],
    body: join(target.index + 1, end),
    before: join(0, target.index + 1),
    after: join(end, lines.length),
    hasAfter: end < lines.length,
    eol,
  };
}

function splitTrailingBreaks(s: string): { content: string; trailing: string } {
  const m = /(?:\r?\n)*$/.exec(s)!;
  return { content: s.slice(0, m.index), trailing: m[0] };
}

function assemble(loc: Located, content: string, trailing: string): string {
  let before = loc.before;
  if (content && !loc.head.eol) before += loc.eol; // heading was the last, unterminated line
  let body = content + trailing;
  if (loc.hasAfter && body && !/\n$/.test(body)) body += loc.eol;
  if (loc.hasAfter && !body && !loc.head.eol) before += loc.eol;
  return before + body + loc.after;
}

export function listSections(description: string): SectionInfo[] {
  return parse(description).headings.map(({ heading, level }) => ({
    heading,
    level,
  }));
}

/** Body of a section (heading line excluded), subsections included, verbatim. */
export function getSection(
  description: string,
  { heading }: { heading: string }
): string {
  return locate(description, heading).body;
}

/** Replace a section's body (subsections included). Heading line is kept. */
export function replaceSection(
  description: string,
  { heading, body }: { heading: string; body: string }
): string {
  const loc = locate(description, heading);
  const { trailing } = splitTrailingBreaks(loc.body);
  return assemble(loc, splitTrailingBreaks(body).content, trailing);
}

/** Append text at the end of a section (after its last subsection). */
export function appendToSection(
  description: string,
  { heading, text }: { heading: string; text: string }
): string {
  const loc = locate(description, heading);
  const { content, trailing } = splitTrailingBreaks(loc.body);
  const add = splitTrailingBreaks(text).content;
  const joined = content ? content + loc.eol + add : add;
  return assemble(loc, joined, trailing);
}

/** Literal find-and-replace over the whole description. */
export function replaceText(
  description: string,
  {
    oldString,
    newString,
    replaceAll = false,
  }: { oldString: string; newString: string; replaceAll?: boolean }
): string {
  if (oldString === "") throw new EmptyOldString();
  const parts = description.split(oldString);
  const count = parts.length - 1;
  if (count === 0) throw new TextNotFound();
  if (count > 1 && !replaceAll) throw new AmbiguousMatch(count);
  return parts.join(newString);
}
