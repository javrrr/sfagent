/**
 * FileReadTool — Read local project files.
 *
 * Restricted to the current working directory to prevent
 * path traversal attacks (reading ~/.ssh, credentials, etc.).
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
      return `Access denied: cannot read sensitive files matching ${pattern}.`;
    }
  }

  return null;
}

export const FileReadTool = buildTool({
  name: "file_read",
  description:
    "Read a file from the local project directory. Returns content with line numbers. " +
    "Paths must be within the current working directory.",
  isReadOnly: true,

  inputSchema: z.object({
    file_path: z
      .string()
      .describe("Relative or absolute path to the file (must be within project directory)"),
    offset: z
      .number()
      .optional()
      .describe("1-based line number to start reading from"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of lines to read (default: 2000)"),
  }),

  async call(args, _ctx) {
    const filePath = path.resolve(args.file_path as string);
    const offset = (args.offset as number | undefined) ?? 1;
    const limit = (args.limit as number | undefined) ?? 2000;

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

    const lines = content.split("\n");
    const startIdx = Math.max(0, offset - 1);
    const endIdx = Math.min(lines.length, startIdx + limit);
    const slice = lines.slice(startIdx, endIdx);

    const numbered = slice
      .map((line, i) => `${String(startIdx + i + 1).padStart(5)} | ${line}`)
      .join("\n");

    const header =
      endIdx < lines.length
        ? `[${filePath}] lines ${startIdx + 1}-${endIdx} of ${lines.length}\n\n`
        : `[${filePath}] ${lines.length} lines\n\n`;

    return { output: header + numbered };
  },
});
