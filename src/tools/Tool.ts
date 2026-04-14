/**
 * Tool interface and buildTool helper.
 *
 * Simplified from Claude Code's Tool.ts (~29K lines) down to the essentials
 * needed for prompt-engineered tool use.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface ToolResult {
  /** Human-readable output to feed back to the model. */
  output: string;
  /** Whether the tool execution failed. */
  isError?: boolean;
}

/**
 * Shared context passed to every tool call.
 * Contains the resolved target org and other session-level state.
 */
export interface ToolContext {
  /** The sf CLI target org alias or username. */
  targetOrg: string;
}

export interface Tool {
  /** Unique tool name used in <tool_call> JSON. */
  name: string;
  /** One-line summary for the system prompt. */
  description: string;
  /** Zod schema for input validation. */
  inputSchema: z.ZodObject<z.ZodRawShape>;
  /** Whether this tool only reads (no side effects). */
  isReadOnly: boolean;
  /** Execute the tool with validated arguments and shared context. */
  call(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Tool definition (partial — buildTool fills defaults)
// ---------------------------------------------------------------------------

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  isReadOnly?: boolean;
  call(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * Build a complete Tool from a partial definition, filling safe defaults.
 * Mirrors Claude Code's buildTool() pattern.
 */
export function buildTool(def: ToolDef): Tool {
  return {
    isReadOnly: false,
    ...def,
  };
}
