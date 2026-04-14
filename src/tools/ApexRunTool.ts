/**
 * ApexRunTool — Execute anonymous Apex code.
 */

import { z } from "zod";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { buildTool } from "./Tool.js";

export const ApexRunTool = buildTool({
  name: "apex_run",
  description:
    "Execute anonymous Apex code against a Salesforce org. " +
    "The code is written to a temp file and run via sf apex run.",
  isReadOnly: false,

  inputSchema: z.object({
    code: z.string().describe("Apex code to execute"),
    target_org: z
      .string()
      .optional()
      .describe("Org alias or username (uses default org if omitted)"),
  }),

  async call(args, ctx) {
    const code = args.code as string;
    const targetOrg = (args.target_org as string | undefined) || ctx.targetOrg;

    // Write to temp file
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `sfagent-apex-${Date.now()}.apex`);
    fs.writeFileSync(tmpFile, code);

    const parts = ["sf", "apex", "run", "--file", tmpFile, "--json"];
    if (targetOrg) parts.push("--target-org", targetOrg);

    try {
      const stdout = execSync(parts.join(" "), {
        encoding: "utf-8",
        timeout: 120_000,
      });

      const result = JSON.parse(stdout);
      const r = result.result;

      const lines: string[] = [];

      if (r.success) {
        lines.push("✓ Execution successful");
      } else {
        lines.push("✗ Execution failed");
        if (r.compileProblem) lines.push(`Compile error: ${r.compileProblem}`);
        if (r.exceptionMessage)
          lines.push(`Exception: ${r.exceptionMessage}`);
        if (r.exceptionStackTrace)
          lines.push(`Stack trace:\n${r.exceptionStackTrace}`);
      }

      if (r.logs) {
        // Show debug logs (truncated)
        const logLines = r.logs.split("\n");
        const userDebug = logLines.filter((l: string) =>
          l.includes("USER_DEBUG") || l.includes("EXCEPTION")
        );
        if (userDebug.length > 0) {
          lines.push("\nDebug output:");
          lines.push(...userDebug.slice(0, 50));
        }
      }

      return {
        output: lines.join("\n"),
        isError: !r.success,
      };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; message: string };
      return {
        output: `Apex execution error: ${execErr.message}`,
        isError: true,
      };
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // ignore cleanup errors
      }
    }
  },
});
