/**
 * System prompt builder.
 *
 * Assembles the system prompt from:
 * 1. Base agent instructions
 * 2. Tool descriptions (serialized from registry)
 * 3. Project/org context
 */

import { getAllTools } from "../tools/registry.js";
import { serializeToolsForPrompt } from "./toolDescriptions.js";
import { getProjectContext } from "./context.js";

export function buildSystemPrompt(): string {
  const tools = getAllTools();
  const toolBlock = serializeToolsForPrompt(tools);
  const ctx = getProjectContext();

  const contextLines: string[] = [];
  if (ctx.cwd) contextLines.push(`- Working directory: ${ctx.cwd}`);
  if (ctx.gitBranch) contextLines.push(`- Git branch: ${ctx.gitBranch}`);
  if (ctx.gitStatus) contextLines.push(`- Git status: ${ctx.gitStatus}`);
  if (ctx.defaultOrg) contextLines.push(`- Default org: ${ctx.defaultOrg}`);
  if (ctx.projectType) contextLines.push(`- Project type: ${ctx.projectType}`);
  if (ctx.apiVersion) contextLines.push(`- API version: ${ctx.apiVersion}`);
  if (ctx.sfCliVersion) contextLines.push(`- SF CLI: ${ctx.sfCliVersion}`);
  if (ctx.date) contextLines.push(`- Date: ${ctx.date}`);

  return `You are sfagent, a Salesforce development assistant running in the user's terminal. You help developers manage Salesforce orgs, deploy code, query data, and debug issues using the Salesforce CLI (sf).

## Tool Use

When you need to perform an action, output a tool call in this exact format:

<tool_call>
{"name": "tool_name", "args": {"param1": "value1"}}
</tool_call>

Rules:
- You may include a SHORT explanation before a tool call (e.g. "Let me query that.") but NEVER include the expected results. Wait for the actual tool output.
- NEVER fabricate, guess, or preview data before a tool has returned. Only present data you received from a tool result.
- You may make multiple tool calls in a single response — each in its own <tool_call> block.
- After you receive tool results, summarize or present them to the user.
- When you have enough information to give a final answer, respond with plain text only (no tool calls).
- If a tool returns an error, diagnose the issue and suggest a fix.

## Available Tools

${toolBlock}

## Current Context

${contextLines.join("\n")}

## Guidelines

- Be concise. Lead with the answer, not the reasoning.
- When running Salesforce CLI commands, prefer JSON output (--json flag) for reliable parsing.
- For destructive operations (deploy to production, delete records), always explain the impact and confirm before proceeding.
- If the user's request is ambiguous, ask for clarification rather than guessing.
- When showing SOQL results, format them as readable tables.
`;
}
