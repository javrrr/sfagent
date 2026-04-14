/**
 * SfCliTool — Run Salesforce CLI (sf) commands.
 *
 * The general-purpose tool for any sf command. Scoped to only
 * allow sf/sfdx commands (not arbitrary shell).
 *
 * Uses execFileSync to prevent shell injection — arguments are
 * passed as an array, never interpreted by a shell.
 */

import { z } from "zod";
import { execFileSync } from "node:child_process";
import { buildTool } from "./Tool.js";

const MAX_OUTPUT = 30_000;

/** Split a command string into args, respecting quotes. */
function parseCommand(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === " " && !inSingle && !inDouble) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);

  return args;
}

/** Validate that args contain no shell metacharacters. */
function containsShellMeta(args: string[]): boolean {
  // These are dangerous in a shell context but safe with execFileSync.
  // We still block them as a defense-in-depth measure for the sf_cli tool
  // since it accepts freeform commands from the LLM.
  const forbidden = /[;|&`$(){}!<>\\]/;
  return args.some((a) => forbidden.test(a));
}

export const SfCliTool = buildTool({
  name: "sf_cli",
  description:
    "Execute a Salesforce CLI (sf) command. The command must start with 'sf'. " +
    "Use --json flag for structured output when possible.",
  isReadOnly: false,

  inputSchema: z.object({
    command: z
      .string()
      .describe('The sf CLI command to run, e.g. "sf org list --json"'),
    timeout_ms: z
      .number()
      .optional()
      .describe("Timeout in milliseconds (default: 120000)"),
  }),

  async call(args, _ctx) {
    const command = args.command as string;
    const timeout = (args.timeout_ms as number | undefined) ?? 120_000;

    const parsed = parseCommand(command.trim());
    if (parsed.length === 0) {
      return { output: "Empty command.", isError: true };
    }

    // Validate: first arg must be sf or sfdx
    const bin = parsed[0]!;
    if (bin !== "sf" && bin !== "sfdx") {
      return {
        output:
          'Command must start with "sf" or "sfdx". ' +
          "Use this tool only for Salesforce CLI commands.",
        isError: true,
      };
    }

    // Defense in depth: reject shell metacharacters
    const cmdArgs = parsed.slice(1);
    if (containsShellMeta(cmdArgs)) {
      return {
        output:
          "Command contains shell metacharacters (;|&`$(){}!<>\\) which are not allowed. " +
          "Provide a plain sf command without shell operators.",
        isError: true,
      };
    }

    try {
      const stdout = execFileSync(bin, cmdArgs, {
        encoding: "utf-8",
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const output =
        stdout.length > MAX_OUTPUT
          ? stdout.slice(0, MAX_OUTPUT) +
            `\n... (truncated, ${stdout.length} total chars)`
          : stdout;

      return { output: output || "(no output)" };
    } catch (err: unknown) {
      const execErr = err as {
        stdout?: string;
        stderr?: string;
        message: string;
      };
      const combined = [execErr.stdout, execErr.stderr]
        .filter(Boolean)
        .join("\n")
        .trim();
      return {
        output: combined || execErr.message,
        isError: true,
      };
    }
  },
});
