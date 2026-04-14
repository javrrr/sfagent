/**
 * Terminal display utilities — chalk-based rendering.
 */

import * as readline from "node:readline";
import chalk from "chalk";
import type { ToolResult } from "../tools/Tool.js";

export interface DisplayCallbacks {
  onThinking(): void;
  onThinkingDone(usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }): void;
  onAssistantText(text: string): void;
  onToolStart(name: string, args: Record<string, unknown>): void;
  onToolResult(name: string, result: ToolResult): void;
  onToolError(name: string, error: string): void;
  onError(message: string): void;
  /**
   * Ask the user to confirm a non-read-only tool execution.
   * Returns 'allow', 'deny', or 'allow-all' (skip future prompts this session).
   */
  confirmToolUse(
    name: string,
    args: Record<string, unknown>,
    description: string
  ): Promise<"allow" | "deny" | "allow-all">;
}

// ---------------------------------------------------------------------------
// Spinner (inline, no extra dependency)
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerInterval: ReturnType<typeof setInterval> | null = null;
let spinnerFrame = 0;

function startSpinner(label: string): void {
  stopSpinner();
  spinnerFrame = 0;
  process.stdout.write(
    `\r${chalk.cyan(SPINNER_FRAMES[0])} ${chalk.dim(label)}`
  );
  spinnerInterval = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    process.stdout.write(
      `\r${chalk.cyan(SPINNER_FRAMES[spinnerFrame])} ${chalk.dim(label)}`
    );
  }, 80);
}

function stopSpinner(): void {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    process.stdout.write("\r\x1b[K"); // clear line
  }
}

// ---------------------------------------------------------------------------
// Confirmation prompt
// ---------------------------------------------------------------------------

function askConfirmation(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ---------------------------------------------------------------------------
// Display implementation
// ---------------------------------------------------------------------------

export function createDisplay(): DisplayCallbacks {
  return {
    onThinking() {
      startSpinner("Thinking...");
    },

    onThinkingDone(usage) {
      stopSpinner();
      if (usage.inputTokens > 0 || usage.outputTokens > 0) {
        console.log(
          chalk.dim(
            `[${usage.inputTokens}→${usage.outputTokens} tokens]`
          )
        );
      }
    },

    onAssistantText(text: string) {
      console.log(`\n${chalk.white(text)}`);
    },

    onToolStart(name: string, args: Record<string, unknown>) {
      const argSummary = Object.entries(args)
        .map(([k, v]) => {
          const val = typeof v === "string" ? v : JSON.stringify(v);
          const truncated = val.length > 60 ? val.slice(0, 57) + "..." : val;
          return `${k}=${truncated}`;
        })
        .join(", ");
      startSpinner(`Running ${name}(${argSummary})`);
    },

    onToolResult(name: string, result: ToolResult) {
      stopSpinner();
      const icon = result.isError ? chalk.red("✗") : chalk.green("✓");
      const header = `${icon} ${chalk.bold(name)}`;
      console.log(header);

      // Truncate very long output for display
      const output = result.output;
      const MAX_DISPLAY_LINES = 30;
      const lines = output.split("\n");
      if (lines.length > MAX_DISPLAY_LINES) {
        const shown = lines.slice(0, MAX_DISPLAY_LINES).join("\n");
        console.log(
          chalk.dim(
            shown + `\n... (${lines.length - MAX_DISPLAY_LINES} more lines)`
          )
        );
      } else {
        console.log(chalk.dim(output));
      }
    },

    onToolError(name: string, error: string) {
      stopSpinner();
      console.log(
        `${chalk.red("✗")} ${chalk.bold(name)}: ${chalk.red(error)}`
      );
    },

    onError(message: string) {
      stopSpinner();
      console.log(chalk.red(`\nError: ${message}`));
    },

    async confirmToolUse(
      name: string,
      args: Record<string, unknown>,
      description: string
    ): Promise<"allow" | "deny" | "allow-all"> {
      console.log(
        `\n${chalk.yellow("⚠")} ${chalk.bold(name)} wants to execute:`
      );
      console.log(chalk.dim(`  ${description}`));

      // Show args
      for (const [key, value] of Object.entries(args)) {
        const val = typeof value === "string" ? value : JSON.stringify(value);
        const display = val.length > 100 ? val.slice(0, 97) + "..." : val;
        console.log(chalk.dim(`  ${key}: ${display}`));
      }

      const answer = await askConfirmation(
        chalk.cyan("\n  Allow? (y)es / (n)o / (a)llow all for session: ")
      );

      if (answer === "a" || answer === "allow" || answer === "allow all") {
        return "allow-all";
      }
      if (
        answer === "y" ||
        answer === "yes" ||
        answer === ""  // Enter = allow
      ) {
        return "allow";
      }
      return "deny";
    },
  };
}
