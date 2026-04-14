/**
 * Parse prompt-engineered tool calls from model text output.
 *
 * The model is instructed to output tool calls in this format:
 *
 *   <tool_call>
 *   {"name": "tool_name", "args": {"param": "value"}}
 *   </tool_call>
 *
 * This parser extracts all such blocks and returns interleaved text segments.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
  rawJson: string;
}

export interface ParsedResponse {
  /** Text segments between/around tool calls (for display). */
  textSegments: string[];
  /** Extracted tool calls in order. */
  toolCalls: ParsedToolCall[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const TOOL_CALL_REGEX = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

export function parseToolCalls(responseText: string): ParsedResponse {
  const textSegments: string[] = [];
  const toolCalls: ParsedToolCall[] = [];

  let lastIndex = 0;

  for (const match of responseText.matchAll(TOOL_CALL_REGEX)) {
    // Text before this tool call
    const textBefore = responseText.slice(lastIndex, match.index).trim();
    if (textBefore) {
      textSegments.push(textBefore);
    }

    const rawJson = match[1]!.trim();

    try {
      const parsed = JSON.parse(rawJson) as {
        name?: string;
        args?: Record<string, unknown>;
      };

      if (!parsed.name || typeof parsed.name !== "string") {
        textSegments.push(`[Malformed tool call: missing "name" field]`);
        continue;
      }

      toolCalls.push({
        name: parsed.name,
        args: parsed.args ?? {},
        rawJson,
      });
    } catch {
      // JSON parse failed — try lenient recovery
      textSegments.push(`[Malformed tool call: invalid JSON]\n${rawJson}`);
    }

    lastIndex = match.index! + match[0].length;
  }

  // Text after the last tool call
  const textAfter = responseText.slice(lastIndex).trim();
  if (textAfter) {
    textSegments.push(textAfter);
  }

  return { textSegments, toolCalls };
}

/**
 * Format tool results for injection back into the conversation.
 */
export function formatToolResult(
  name: string,
  result: { output: string; isError?: boolean }
): string {
  const tag = result.isError ? "tool_error" : "tool_result";
  return `<${tag} name="${name}">\n${result.output}\n</${tag}>`;
}
