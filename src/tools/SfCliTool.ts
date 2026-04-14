/**
 * SfCliTool — Run Salesforce CLI (sf) commands.
 *
 * The general-purpose tool for any sf command. Scoped to only
 * allow sf/sfdx commands (not arbitrary shell).
 */

import { z } from "zod";
import { execSync } from "node:child_process";
import { buildTool } from "./Tool.js";

const MAX_OUTPUT = 30_000;

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

    // Validate: must start with sf or sfdx
    const trimmed = command.trim();
    if (!trimmed.startsWith("sf ") && !trimmed.startsWith("sfdx ")) {
      return {
        output:
          'Command must start with "sf" or "sfdx". ' +
          "Use this tool only for Salesforce CLI commands.",
        isError: true,
      };
    }

    try {
      const stdout = execSync(trimmed, {
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
      const execErr = err as { stdout?: string; stderr?: string; message: string };
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
