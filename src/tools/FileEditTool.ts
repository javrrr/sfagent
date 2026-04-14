/**
 * FileEditTool — Search-and-replace edits on local files.
 *
 * Mirrors Claude Code's FileEditTool pattern: exact string matching
 * with old_text → new_text replacement.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { buildTool } from "./Tool.js";

export const FileEditTool = buildTool({
  name: "file_edit",
  description:
    "Edit a local file by replacing an exact string match. " +
    "Provide the old text and new text for a search-and-replace operation.",
  isReadOnly: false,

  inputSchema: z.object({
    file_path: z.string().describe("Path to the file to edit"),
    old_text: z.string().describe("Exact text to find and replace"),
    new_text: z.string().describe("Replacement text"),
  }),

  async call(args, _ctx) {
    const filePath = path.resolve(args.file_path as string);
    const oldText = args.old_text as string;
    const newText = args.new_text as string;

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch (err) {
      return {
        output: `Error reading file: ${(err as Error).message}`,
        isError: true,
      };
    }

    // Check for exact match
    const index = content.indexOf(oldText);
    if (index === -1) {
      return {
        output: `old_text not found in ${filePath}. Make sure the text matches exactly (including whitespace and indentation).`,
        isError: true,
      };
    }

    // Check for multiple matches
    const secondIndex = content.indexOf(oldText, index + 1);
    if (secondIndex !== -1) {
      return {
        output: `old_text matches multiple locations in ${filePath}. Provide more surrounding context to make the match unique.`,
        isError: true,
      };
    }

    // Apply replacement
    const updated = content.slice(0, index) + newText + content.slice(index + oldText.length);
    await fs.writeFile(filePath, updated);

    // Show a simple diff preview
    const oldLines = oldText.split("\n");
    const newLines = newText.split("\n");
    const diffLines: string[] = [];
    for (const line of oldLines) diffLines.push(`- ${line}`);
    for (const line of newLines) diffLines.push(`+ ${line}`);

    return {
      output: `Edited ${filePath}:\n\n${diffLines.join("\n")}`,
    };
  },
});
