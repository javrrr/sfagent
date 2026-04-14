/**
 * OrgInfoTool — Display information about connected Salesforce orgs.
 */

import { z } from "zod";
import { execSync } from "node:child_process";
import { buildTool } from "./Tool.js";

export const OrgInfoTool = buildTool({
  name: "org_info",
  description:
    "Get information about Salesforce orgs. " +
    'Use action "display" to show details of a specific org, or "list" to list all connected orgs.',
  isReadOnly: true,

  inputSchema: z.object({
    action: z.enum(["display", "list"]).describe('"display" or "list"'),
    target_org: z
      .string()
      .optional()
      .describe("Org alias or username (for display action)"),
  }),

  async call(args, ctx) {
    const action = args.action as string;
    const targetOrg = (args.target_org as string | undefined) || ctx.targetOrg;

    const parts: string[] = [];

    if (action === "list") {
      parts.push("sf", "org", "list", "--json");
    } else {
      parts.push("sf", "org", "display", "--json");
      if (targetOrg) parts.push("--target-org", targetOrg);
    }

    try {
      const stdout = execSync(parts.join(" "), {
        encoding: "utf-8",
        timeout: 30_000,
      });

      const result = JSON.parse(stdout);

      if (action === "list") {
        const orgs = [
          ...(result.result?.nonScratchOrgs ?? []),
          ...(result.result?.scratchOrgs ?? []),
        ];
        if (orgs.length === 0) return { output: "No connected orgs found." };

        const lines = orgs.map((o: Record<string, unknown>) => {
          const alias = o.alias || "(no alias)";
          const username = o.username;
          const type = o.isScratch ? "scratch" : o.isDevHub ? "devhub" : "org";
          const connected = o.connectedStatus === "Connected" ? "✓" : "✗";
          return `  ${connected} ${alias} — ${username} (${type})`;
        });
        return { output: `Connected orgs:\n${lines.join("\n")}` };
      }

      // display
      const org = result.result;
      const info = [
        `Org:        ${org.alias || "(no alias)"} — ${org.username}`,
        `Org ID:     ${org.id}`,
        `Instance:   ${org.instanceUrl}`,
        `API:        v${org.apiVersion}`,
        `Status:     ${org.connectedStatus}`,
        `Type:       ${org.isScratch ? "Scratch" : org.isDevHub ? "DevHub" : "Production/Sandbox"}`,
      ];
      if (org.expirationDate) info.push(`Expires:    ${org.expirationDate}`);

      return { output: info.join("\n") };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; message: string };
      return { output: `Error: ${execErr.message}`, isError: true };
    }
  },
});
