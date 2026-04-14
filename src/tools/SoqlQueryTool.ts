/**
 * SoqlQueryTool — Execute SOQL queries with formatted output.
 */

import { z } from "zod";
import { execSync } from "node:child_process";
import { buildTool } from "./Tool.js";

interface QueryResult {
  status: number;
  result: {
    records: Record<string, unknown>[];
    totalSize: number;
    done: boolean;
  };
}

function flatten(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    // Handle relationship fields (e.g. Account.Name)
    const obj = value as Record<string, unknown>;
    if ("attributes" in obj) {
      // Salesforce sObject — return meaningful fields
      const { attributes: _, ...rest } = obj;
      const vals = Object.values(rest).map(flatten).filter(Boolean);
      return vals.join(", ");
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function formatTable(records: Record<string, unknown>[]): string {
  if (records.length === 0) return "(no records)";

  // Collect column names (skip 'attributes')
  const columns = Object.keys(records[0]!).filter((k) => k !== "attributes");

  // Flatten all values first
  const rows = records.map((r) =>
    columns.map((col) => flatten(r[col]))
  );

  // Calculate column widths
  const widths = columns.map((col, i) =>
    Math.max(col.length, ...rows.map((r) => r[i]!.length))
  );

  // Cap column widths at 50 to prevent blowout
  const cappedWidths = widths.map((w) => Math.min(w, 50));

  // Header
  const header = columns
    .map((col, i) => col.padEnd(cappedWidths[i]!))
    .join("  ");
  const separator = cappedWidths.map((w) => "─".repeat(w)).join("──");

  // Rows
  const formattedRows = rows.map((r) =>
    r
      .map((val, i) => {
        const truncated =
          val.length > cappedWidths[i]!
            ? val.slice(0, cappedWidths[i]! - 1) + "…"
            : val;
        return truncated.padEnd(cappedWidths[i]!);
      })
      .join("  ")
  );

  return [header, separator, ...formattedRows].join("\n");
}

export const SoqlQueryTool = buildTool({
  name: "soql_query",
  description:
    "Execute a SOQL query against the default or specified Salesforce org. " +
    "Returns results as a formatted table.",
  isReadOnly: true,

  inputSchema: z.object({
    query: z.string().describe("The SOQL query string"),
    target_org: z
      .string()
      .optional()
      .describe("Org alias or username (uses default org if omitted)"),
    use_tooling_api: z
      .boolean()
      .optional()
      .describe("Use the Tooling API instead of the standard API"),
  }),

  async call(args, ctx) {
    const query = args.query as string;
    const targetOrg = (args.target_org as string | undefined) || ctx.targetOrg;
    const useTooling = args.use_tooling_api as boolean | undefined;

    // Build args array for execa-style execution to avoid shell quoting issues
    const sfArgs = ["data", "query", "--query", query, "--json"];
    if (targetOrg) sfArgs.push("--target-org", targetOrg);
    if (useTooling) sfArgs.push("--use-tooling-api");

    try {
      const stdout = execSync(`sf ${sfArgs.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`, {
        encoding: "utf-8",
        timeout: 60_000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const result = JSON.parse(stdout) as QueryResult;
      const records = result.result.records;
      const table = formatTable(records);
      const summary = `${result.result.totalSize} record(s)${result.result.done ? "" : " (more available)"}`;

      return { output: `${summary}\n\n${table}` };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; message: string };
      let errorMsg = execErr.message;
      if (execErr.stdout) {
        try {
          const parsed = JSON.parse(execErr.stdout);
          errorMsg = parsed.message || parsed.result?.message || errorMsg;
        } catch {
          // use raw message
        }
      }
      return { output: `SOQL error: ${errorMsg}`, isError: true };
    }
  },
});
