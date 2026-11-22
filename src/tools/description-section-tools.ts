import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";
import {
  SectionError,
  appendToSection,
  getSection,
  listSections,
  replaceSection,
  replaceText,
} from "../description-sections.js";

// Section-level description tools shared by issues and projects. Each resource
// supplies only how to address it (ids, API path, payload key, display label);
// tool copy, output formats and error mapping live here so both stay identical.

interface DescribedResource {
  description?: string | null;
}

interface SectionToolConfig<R extends DescribedResource> {
  noun: "issue" | "project";
  /** Zod shape for the ids that address one resource. */
  idShape: z.ZodRawShape;
  /** API path of the resource, from the tool args. */
  path: (args: any) => string;
  /** Key the PATCH body is nested under. */
  bodyKey: string;
  /** Resource identifier used in confirmations, from the PATCH response. */
  label: (resource: R, args: any) => string;
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const textResult = (text: string): ToolResult => ({
  content: [{ type: "text", text }],
});

// Splicer failures are expected: show the message to the agent as an error
// result. Anything else (network, auth) propagates.
function sectionErrorResult(err: unknown): ToolResult {
  if (err instanceof SectionError) {
    return { ...textResult(err.message), isError: true };
  }
  throw err;
}

const headingArg = z
  .string()
  .describe('Exact heading text without the leading #s, e.g. "Goals"');

export function registerDescriptionSectionTools<R extends DescribedResource>(
  server: McpServer,
  cfg: SectionToolConfig<R>
) {
  const { noun, idShape, path, bodyKey, label } = cfg;
  const upper = noun[0].toUpperCase() + noun.slice(1);
  const note = ` Use this instead of update_${noun} for partial description edits.`;

  const fetchDescription = async (args: unknown) =>
    (await apiRequest<R>(path(args))).description ?? "";

  // Fetch, splice, PATCH. Returns a short confirmation, never the description.
  const edit = async (
    args: unknown,
    splice: (description: string) => string,
    confirmation: (identifier: string) => string
  ): Promise<ToolResult> => {
    try {
      const updated = splice(await fetchDescription(args));
      const saved = await apiRequest<R>(path(args), {
        method: "PATCH",
        body: { [bodyKey]: { description: updated } },
      });
      return textResult(confirmation(label(saved, args)));
    } catch (err) {
      return sectionErrorResult(err);
    }
  };

  server.tool(
    `list_${noun}_sections`,
    `List the headings (with levels) in ${noun === "issue" ? "an issue" : "a project"}'s description. Start here to see what sections exist before reading or editing one.`,
    idShape,
    async (args: any) => {
      const sections = listSections(await fetchDescription(args));
      return textResult(
        sections.length
          ? sections.map((s) => `${"#".repeat(s.level)} ${s.heading}`).join("\n")
          : "No sections found."
      );
    }
  );

  server.tool(
    `get_${noun}_section`,
    `Read one section of ${noun === "issue" ? "an issue" : "a project"}'s description (heading excluded, subsections included) without loading the whole description. Use this instead of get_${noun} when you only need one section.`,
    { ...idShape, heading: headingArg },
    async (args: any) => {
      try {
        const body = getSection(await fetchDescription(args), {
          heading: args.heading,
        });
        return textResult(body || "(empty section)");
      } catch (err) {
        return sectionErrorResult(err);
      }
    }
  );

  server.tool(
    `replace_${noun}_section`,
    `Replace the body of one section of ${noun === "issue" ? "an issue" : "a project"}'s description, keeping its heading. Use when rewriting most of a section; to add to the end use append_to_${noun}_section, for small tweaks use edit_${noun}_description.${note}`,
    {
      ...idShape,
      heading: headingArg,
      body: z.string().describe("New section body in markdown (heading not included)"),
    },
    async (args: any) =>
      edit(
        args,
        (d) => replaceSection(d, { heading: args.heading, body: args.body }),
        (id) => `Replaced section "${args.heading}" in ${id}.`
      )
  );

  server.tool(
    `append_to_${noun}_section`,
    `Append text to the end of one section of ${noun === "issue" ? "an issue" : "a project"}'s description. Use when adding to a section without touching what is there; to rewrite it use replace_${noun}_section.${note}`,
    {
      ...idShape,
      heading: headingArg,
      text: z.string().describe("Markdown text to append"),
    },
    async (args: any) =>
      edit(
        args,
        (d) => appendToSection(d, { heading: args.heading, text: args.text }),
        (id) => `Appended to section "${args.heading}" in ${id}.`
      )
  );

  server.tool(
    `edit_${noun}_description`,
    `Find-and-replace literal text in ${noun === "issue" ? "an issue" : "a project"}'s description. Use for small edits inside a section (a word, a line, a checkbox); fails if old_string is not found or matches more than once unless replace_all is true.${note}`,
    {
      ...idShape,
      old_string: z.string().describe("Exact text to find"),
      new_string: z.string().describe("Replacement text"),
      replace_all: z
        .boolean()
        .optional()
        .describe("Replace every match instead of requiring exactly one"),
    },
    async (args: any) =>
      edit(
        args,
        (d) =>
          replaceText(d, {
            oldString: args.old_string,
            newString: args.new_string,
            replaceAll: args.replace_all,
          }),
        (id) => `Edited description of ${id}.`
      )
  );
}
