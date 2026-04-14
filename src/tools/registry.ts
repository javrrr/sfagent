/**
 * Tool registry — central registration and lookup.
 *
 * Mirrors Claude Code's tools.ts pattern: a single source of truth
 * for all available tools.
 */

import type { Tool } from "./Tool.js";
import { FileReadTool } from "./FileReadTool.js";
import { FileEditTool } from "./FileEditTool.js";
import { SfCliTool } from "./SfCliTool.js";
import { SoqlQueryTool } from "./SoqlQueryTool.js";
import { OrgInfoTool } from "./OrgInfoTool.js";
import { DeployTool } from "./DeployTool.js";
import { ApexRunTool } from "./ApexRunTool.js";

const ALL_TOOLS: Tool[] = [
  FileReadTool,
  FileEditTool,
  SfCliTool,
  SoqlQueryTool,
  OrgInfoTool,
  DeployTool,
  ApexRunTool,
];

export function getAllTools(): Tool[] {
  return ALL_TOOLS;
}

export function findTool(name: string): Tool | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

export function registerTool(tool: Tool): void {
  ALL_TOOLS.push(tool);
}
