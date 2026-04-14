/**
 * Collect project and git context for the system prompt.
 *
 * Mirrors Claude Code's context.ts pattern: memoized context
 * collection run once per session.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

let _cachedContext: Record<string, string> | null = null;

function tryExec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

export function getProjectContext(): Record<string, string> {
  if (_cachedContext) return _cachedContext;

  const ctx: Record<string, string> = {};

  // Working directory
  ctx.cwd = process.cwd();

  // Date
  ctx.date = new Date().toISOString().split("T")[0]!;

  // Git context
  const branch = tryExec("git rev-parse --abbrev-ref HEAD");
  if (branch) {
    ctx.gitBranch = branch;
    const status = tryExec("git status --short");
    ctx.gitStatus = status || "(clean)";
  }

  // Salesforce project detection
  const sfdxProjectPath = path.join(process.cwd(), "sfdx-project.json");
  if (fs.existsSync(sfdxProjectPath)) {
    ctx.projectType = "sfdx";
    try {
      const proj = JSON.parse(fs.readFileSync(sfdxProjectPath, "utf-8"));
      if (proj.namespace) ctx.namespace = proj.namespace;
      if (proj.sourceApiVersion) ctx.apiVersion = proj.sourceApiVersion;
    } catch {
      // ignore parse errors
    }
  }

  // Default org (from sf CLI)
  const defaultOrg = tryExec(
    "sf config get target-org --json 2>/dev/null"
  );
  if (defaultOrg) {
    try {
      const parsed = JSON.parse(defaultOrg);
      const value = parsed?.result?.[0]?.value;
      if (value) ctx.defaultOrg = value;
    } catch {
      // ignore
    }
  }

  // SF CLI version
  const sfVersion = tryExec("sf --version 2>/dev/null");
  if (sfVersion) {
    ctx.sfCliVersion = sfVersion.split("\n")[0]!;
  }

  _cachedContext = ctx;
  return ctx;
}
