/**
 * Agent loop — the core orchestrator.
 *
 * Simplified from Claude Code's query.ts (~1700 lines).
 * Sends messages → parses tool calls → confirms with user → executes → loops.
 *
 * Permission model:
 *   - Read-only tools (file_read, soql_query, org_info): auto-execute
 *   - Non-read-only tools (deploy, sf_cli, file_edit, apex_run): ask user first
 *   - User can choose: allow once, deny, or allow all for session
 */

import type { Message, SfAgentConfig } from "./api/types.js";
import type { LLMProvider } from "./api/modelsClient.js";
import type { ToolContext } from "./tools/Tool.js";
import { getAllTools, findTool } from "./tools/registry.js";
import {
  parseToolCalls,
  formatToolResult,
} from "./parser/toolCallParser.js";
import { buildSystemPrompt } from "./prompt/systemPrompt.js";
import type { DisplayCallbacks } from "./ui/display.js";

export interface AgentOptions {
  maxTurns?: number;
  /** When aborted (e.g. Ctrl+C), cancels the Models API request and rolls back this turn. */
  signal?: AbortSignal;
}

function isAbortError(err: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      err instanceof DOMException &&
      err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

export async function runAgentLoop(
  provider: LLMProvider,
  userMessage: string,
  conversationHistory: Message[],
  display: DisplayCallbacks,
  config: SfAgentConfig,
  options: AgentOptions = {}
): Promise<void> {
  const maxTurns = options.maxTurns ?? 20;
  const signal = options.signal;
  const systemPrompt = buildSystemPrompt();

  const historyBaseline = conversationHistory.length;

  function rollback(): void {
    conversationHistory.length = historyBaseline;
  }

  function handleUserAbort(): void {
    rollback();
    display.onCancelled();
  }

  // Tool context — shared state for all tool calls
  const toolCtx: ToolContext = {
    targetOrg: config.targetOrg,
  };

  // Session-level auto-approve set (tool names the user said "allow all" for)
  const autoApproved = new Set<string>();

  // Append the new user message
  conversationHistory.push({ role: "user", content: userMessage });

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) {
      handleUserAbort();
      return;
    }

    // Build the full message array with system prompt
    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
    ];

    // Call the LLM (fetch uses signal so the HTTP request is cancelled when possible)
    display.onThinking();
    let response;
    try {
      response = await provider.chat(messages, { signal });
    } catch (err) {
      if (isAbortError(err)) {
        handleUserAbort();
        return;
      }
      display.onError(`API error: ${(err as Error).message}`);
      return;
    }

    if (signal?.aborted) {
      handleUserAbort();
      return;
    }

    display.onThinkingDone(response.usage);

    // Parse for tool calls
    const parsed = parseToolCalls(response.content);

    // No tool calls → final response, display all text
    if (parsed.toolCalls.length === 0) {
      if (signal?.aborted) {
        handleUserAbort();
        return;
      }
      for (const text of parsed.textSegments) {
        display.onAssistantText(text);
      }
      conversationHistory.push({
        role: "assistant",
        content: response.content,
      });
      return;
    }

    // Has tool calls — suppress ALL text from this response.
    // The model often hallucinates/fabricates data before the tool runs.
    // Real results will be presented in the next turn after tool execution.

    // Execute tool calls and collect results
    const resultParts: string[] = [];

    for (const toolCall of parsed.toolCalls) {
      const tool = findTool(toolCall.name);

      if (!tool) {
        const errResult = formatToolResult(toolCall.name, {
          output: `Unknown tool: "${toolCall.name}". Available tools: ${getAllTools().map((t) => t.name).join(", ")}`,
          isError: true,
        });
        resultParts.push(errResult);
        display.onToolError(toolCall.name, "Unknown tool");
        continue;
      }

      // Validate input against schema
      const validation = tool.inputSchema.safeParse(toolCall.args);
      if (!validation.success) {
        const errMsg = validation.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        const errResult = formatToolResult(toolCall.name, {
          output: `Invalid arguments: ${errMsg}`,
          isError: true,
        });
        resultParts.push(errResult);
        display.onToolError(toolCall.name, errMsg);
        continue;
      }

      // Permission check: non-read-only tools require confirmation
      if (!tool.isReadOnly && !autoApproved.has(tool.name)) {
        let decision: "allow" | "deny" | "allow-all";
        try {
          decision = await display.confirmToolUse(
            tool.name,
            toolCall.args,
            tool.description,
            { signal }
          );
        } catch (err) {
          if (isAbortError(err)) {
            handleUserAbort();
            return;
          }
          throw err;
        }

        if (decision === "deny") {
          const denyResult = formatToolResult(toolCall.name, {
            output:
              "User denied this action. Ask the user what they'd like to do instead.",
            isError: true,
          });
          resultParts.push(denyResult);
          display.onToolError(toolCall.name, "Denied by user");
          continue;
        }

        if (decision === "allow-all") {
          autoApproved.add(tool.name);
        }
      }

      // Execute tool
      display.onToolStart(toolCall.name, toolCall.args);
      let result;
      try {
        result = await tool.call(validation.data, toolCtx);
      } catch (err) {
        result = {
          output: `Tool execution error: ${(err as Error).message}`,
          isError: true,
        };
      }

      display.onToolResult(toolCall.name, result);
      resultParts.push(formatToolResult(toolCall.name, result));

      if (signal?.aborted) {
        handleUserAbort();
        return;
      }
    }

    if (signal?.aborted) {
      handleUserAbort();
      return;
    }

    // Append assistant message (full response) and tool results
    conversationHistory.push({
      role: "assistant",
      content: response.content,
    });
    conversationHistory.push({
      role: "user",
      content: resultParts.join("\n\n"),
    });
  }

  display.onError(
    `Reached maximum turns (${maxTurns}). Use /clear to reset.`
  );
}
