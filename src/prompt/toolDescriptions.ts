/**
 * Serialize tool definitions for injection into the system prompt.
 *
 * Converts Zod schemas into human-readable parameter descriptions
 * that the model can understand.
 */

import type { Tool } from "../tools/Tool.js";
import type { z } from "zod";

function describeZodShape(schema: z.ZodObject<z.ZodRawShape>): string {
  const shape = schema.shape;
  const lines: string[] = [];

  for (const [key, field] of Object.entries(shape)) {
    const zodField = field as z.ZodTypeAny;
    const isOptional = zodField.isOptional();
    const description = zodField.description ?? "";

    // Extract the inner type name
    let typeName = "unknown";
    const def = zodField._def;
    if (def.typeName === "ZodString") typeName = "string";
    else if (def.typeName === "ZodNumber") typeName = "number";
    else if (def.typeName === "ZodBoolean") typeName = "boolean";
    else if (def.typeName === "ZodOptional") {
      const inner = def.innerType?._def;
      if (inner?.typeName === "ZodString") typeName = "string";
      else if (inner?.typeName === "ZodNumber") typeName = "number";
      else if (inner?.typeName === "ZodBoolean") typeName = "boolean";
    }

    const req = isOptional ? "optional" : "required";
    lines.push(`  - ${key} (${typeName}, ${req}): ${description}`);
  }

  return lines.join("\n");
}

export function serializeToolsForPrompt(tools: Tool[]): string {
  return tools
    .map(
      (tool) =>
        `### ${tool.name}\n${tool.description}\nParameters:\n${describeZodShape(tool.inputSchema)}`
    )
    .join("\n\n");
}
