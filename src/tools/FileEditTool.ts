/**
 * FileEditTool — Search-and-replace edits on local files.
 *
 * Restricted to the current working directory to prevent
 * path traversal attacks (writing to ~/.bashrc, etc.).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { buildTool } from "./Tool.js";

const BLOCKED_PATTERNS = [
  /\.sfagent/,
  /\.ssh/,
  /\.aws/,
  /\.gnupg/,
  /\.env$/,
  /\.env\./,
  /credentials\.json/,
  /token\.json/,
  /\.netrc/,
];

function validatePath(filePath: string): string | null {
  const resolved = path.resolve(filePath);
  const cwd = process.cwd();

  if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
    return `Access denied: path is outside the working directory (${cwd}).`;
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(resolved)) {
      return `Access denied: cannot edit sensitive files matching ${pattern}.`;
    }
  }

  return null;
}

export const FileEditTool = buildTool({
  name: "file_edit",
  description:
    "Edit a local file by replacing an exact string match. " +
    "Paths must be within the current working directory.",
  isReadOnly: false,

  inputSchema: z.object({
    file_path: z
      .string()
      .describe("Path to the file to edit (must be within project directory)"),
    old_text: z.string().describe("Exact text to find and replace"),
    new_text: z.string().describe("Replacement text"),
  }),

  async call(args, _ctx) {
    const filePath = path.resolve(args.file_path as string);
    const oldText = args.old_text as string;
    const newText = args.new_text as string;

    const error = validatePath(filePath);
    if (error) {
      return { output: error, isError: true };
    }

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch (err) {
      return {
        output: `Error reading file: ${(err as Error).message}`,
        isError: true,
      };
    }

    const index = content.indexOf(oldText);
    if (index === -1) {
      return {
        output: `old_text not found in ${filePath}. Make sure the text matches exactly (including whitespace and indentation).`,
        isError: true,
      };
    }

    const secondIndex = content.indexOf(oldText, index + 1);
    if (secondIndex !== -1) {
      return {
        output: `old_text matches multiple locations in ${filePath}. Provide more surrounding context to make the match unique.`,
        isError: true,
      };
    }

    const updated =
      content.slice(0, index) + newText + content.slice(index + oldText.length);
    await fs.writeFile(filePath, updated);

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
