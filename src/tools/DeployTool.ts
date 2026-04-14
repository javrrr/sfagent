/**
 * DeployTool — Deploy Salesforce metadata via sf project deploy.
 */

import { z } from "zod";
import { execSync } from "node:child_process";
import { buildTool } from "./Tool.js";

export const DeployTool = buildTool({
  name: "deploy",
  description:
    "Deploy Salesforce project metadata to an org using sf project deploy start. " +
    "Returns deployment status including component and test results.",
  isReadOnly: false,

  inputSchema: z.object({
    source_dir: z
      .string()
      .optional()
      .describe('Source directory to deploy (default: project default, e.g. "force-app")'),
    target_org: z
      .string()
      .optional()
      .describe("Org alias or username to deploy to"),
    test_level: z
      .enum([
        "NoTestRun",
        "RunSpecifiedTests",
        "RunLocalTests",
        "RunAllTestsInOrg",
      ])
      .optional()
      .describe("Test level for the deployment"),
    run_tests: z
      .string()
      .optional()
      .describe("Comma-separated test class names (when test_level is RunSpecifiedTests)"),
    wait_minutes: z
      .number()
      .optional()
      .describe("Minutes to wait for deployment (default: 33)"),
    dry_run: z
      .boolean()
      .optional()
      .describe("Validate only, do not actually deploy"),
  }),

  async call(args, ctx) {
    const parts = ["sf", "project", "deploy", "start", "--json"];

    const targetOrg = (args.target_org as string | undefined) || ctx.targetOrg;
    if (args.source_dir) parts.push("--source-dir", args.source_dir as string);
    if (targetOrg) parts.push("--target-org", targetOrg);
    if (args.test_level) parts.push("--test-level", args.test_level as string);
    if (args.run_tests) parts.push("--tests", args.run_tests as string);
    if (args.dry_run) parts.push("--dry-run");

    const wait = (args.wait_minutes as number | undefined) ?? 33;
    parts.push("--wait", String(wait));

    try {
      const stdout = execSync(parts.join(" "), {
        encoding: "utf-8",
        timeout: (wait + 2) * 60_000,
      });

      const result = JSON.parse(stdout);
      const status = result.result;

      const lines = [
        `Status:     ${status.status}`,
        `Components: ${status.numberComponentsDeployed ?? 0} deployed, ${status.numberComponentErrors ?? 0} errors`,
      ];

      if (status.numberTestsCompleted != null) {
        lines.push(
          `Tests:      ${status.numberTestsCompleted} completed, ${status.numberTestErrors ?? 0} failures`
        );
      }

      if (status.details?.componentFailures?.length) {
        lines.push("\nComponent Failures:");
        for (const f of status.details.componentFailures.slice(0, 10)) {
          lines.push(`  ✗ ${f.fullName}: ${f.problem}`);
        }
      }

      if (status.details?.runTestResult?.failures?.length) {
        lines.push("\nTest Failures:");
        for (const f of status.details.runTestResult.failures.slice(0, 10)) {
          lines.push(`  ✗ ${f.name}.${f.methodName}: ${f.message}`);
        }
      }

      return {
        output: lines.join("\n"),
        isError: status.status === "Failed",
      };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; message: string };
      let errorMsg = execErr.message;
      if (execErr.stdout) {
        try {
          const parsed = JSON.parse(execErr.stdout);
          errorMsg =
            parsed.message ||
            parsed.result?.details?.componentFailures
              ?.map((f: { fullName: string; problem: string }) => `${f.fullName}: ${f.problem}`)
              .join("\n") ||
            errorMsg;
        } catch {
          // use raw
        }
      }
      return { output: `Deploy error: ${errorMsg}`, isError: true };
    }
  },
});
