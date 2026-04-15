/**
 * Interactive REPL — readline-based terminal interface.
 */

import * as readline from "node:readline";
import type { Readable } from "node:stream";
import chalk from "chalk";
import type { Message, SfAgentConfig } from "./api/types.js";
import type { LLMProvider } from "./api/modelsClient.js";
import { SalesforceModelsProvider } from "./api/modelsClient.js";
import { loginWithSfCli, getOrgInfo } from "./api/auth.js";
import { runSetup } from "./setup.js";
import { runAgentLoop } from "./agent.js";
import { createDisplay } from "./ui/display.js";
import {
  PASTE_LINE_BREAK,
  createBracketedPasteTransform,
  detachBracketedPasteTransform,
  disableBracketedPasteMode,
  enableBracketedPasteMode,
} from "./repl/bracketedPasteTransform.js";

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

async function handleSlashCommand(
  input: string,
  provider: LLMProvider,
  history: Message[],
  config: SfAgentConfig,
  rl: readline.Interface
): Promise<"handled" | "setup" | "not_handled"> {
  const [cmd, ...rest] = input.trim().split(/\s+/);

  switch (cmd) {
    case "/exit":
    case "/quit":
      disableBracketedPasteMode();
      console.log(chalk.dim("Goodbye."));
      process.exit(0);

    case "/clear":
      history.length = 0;
      console.log(chalk.dim("Conversation cleared."));
      return "handled";

    case "/model": {
      const modelName = rest.join(" ");
      if (!modelName) {
        if (provider instanceof SalesforceModelsProvider) {
          console.log(chalk.dim(`Current model: ${provider.getModel()}`));
        }
      } else if (provider instanceof SalesforceModelsProvider) {
        provider.setModel(modelName);
        console.log(chalk.dim(`Model set to: ${modelName}`));
      }
      return "handled";
    }

    case "/login": {
      const alias = rest[0];
      try {
        loginWithSfCli(alias);
        const orgInfo = getOrgInfo(config.targetOrg || undefined);
        console.log(
          chalk.green("✓ Logged in") +
            chalk.dim(` as ${orgInfo.username || "unknown"}`)
        );
      } catch (err) {
        console.log(chalk.red((err as Error).message));
      }
      return "handled";
    }

    case "/setup":
      return "setup";

    case "/org": {
      const orgInfo = getOrgInfo(config.targetOrg || undefined);
      if (Object.keys(orgInfo).length === 0) {
        console.log(chalk.dim("No org info available. Run /login first."));
      } else {
        for (const [key, value] of Object.entries(orgInfo)) {
          if (value) console.log(chalk.dim(`  ${key}: ${value}`));
        }
      }
      return "handled";
    }

    case "/history":
      console.log(
        chalk.dim(`${history.length} messages in conversation history.`)
      );
      return "handled";

    case "/help":
      console.log(
        chalk.dim(`
Available commands:
  /setup           Configure Models API credentials
  /login [alias]   Log in to a Salesforce org via sf CLI
  /org             Show current org details
  /model [name]    Show or set the current model
  /clear           Clear conversation history
  /history         Show message count
  /help            Show this help
  /exit            Exit sfagent
`)
      );
      return "handled";

    default:
      return "not_handled";
  }
}

// ---------------------------------------------------------------------------
// REPL
// ---------------------------------------------------------------------------

export async function startRepl(
  provider: LLMProvider,
  config: SfAgentConfig
): Promise<void> {
  const history: Message[] = [];

  console.log(
    chalk.bold.cyan("\n  sfagent") +
      chalk.dim(" — Salesforce development assistant\n")
  );
  console.log(
    chalk.dim("  Type a message to get started. /help for commands.\n")
  );

  // Bracketed paste (like Claude Code / Ink): multi-line paste → one message.
  let stdinForRepl: Readable = process.stdin;
  let pasteTransform: Readable | null = null;
  if (process.stdin.isTTY) {
    enableBracketedPasteMode();
    process.once("exit", () => disableBracketedPasteMode());
    pasteTransform = createBracketedPasteTransform(process.stdin);
    stdinForRepl = pasteTransform;
  }

  function createRl(): readline.Interface {
    return readline.createInterface({
      input: stdinForRepl,
      output: process.stdout,
      prompt: chalk.cyan("sfagent> "),
    });
  }

  /** While set, Ctrl+C aborts the in-flight agent run (and the Models API request). */
  let agentAbortController: AbortController | null = null;

  function attachSigintHandler(rl: readline.Interface): void {
    rl.on("SIGINT", () => {
      if (agentAbortController) {
        agentAbortController.abort();
        return;
      }
      if (rl.line.length === 0) {
        disableBracketedPasteMode();
        console.log(chalk.dim("\nGoodbye."));
        process.exit(0);
      }
      // Emacs readline: start of line + kill forward — clears full user input.
      rl.write(null, { ctrl: true, name: "a" });
      rl.write(null, { ctrl: true, name: "k" });
      rl.prompt();
    });
  }

  let rl = createRl();
  attachSigintHandler(rl);
  let display = createDisplay(rl);

  function startListening(): void {
    rl.prompt();

    rl.on("line", async (line: string) => {
      const text = line.split(PASTE_LINE_BREAK).join("\n");
      const input = text.trim();

      if (!input) {
        rl.prompt();
        return;
      }

      // Handle slash commands
      if (input.startsWith("/")) {
        const result = await handleSlashCommand(
          input,
          provider,
          history,
          config,
          rl
        );

        if (result === "setup") {
          // Setup needs exclusive stdin control (inquirer).
          // Close this readline — setup will close it again (harmless).
          rl.close();
          process.stdin.removeAllListeners("keypress");
          if (pasteTransform) {
            detachBracketedPasteTransform(process.stdin, pasteTransform);
            pasteTransform = null;
            stdinForRepl = process.stdin;
          }

          try {
            await runSetup(config);
            const { loadCredentials } = await import("./api/auth.js");
            config.credentials = await loadCredentials();
          } catch (err) {
            console.log(chalk.red((err as Error).message));
          }

          if (process.stdin.isTTY) {
            pasteTransform = createBracketedPasteTransform(process.stdin);
            stdinForRepl = pasteTransform;
          }

          // Recreate readline after setup completes
          rl = createRl();
          attachSigintHandler(rl);
          display = createDisplay(rl);
          startListening();
          return;
        }

        if (result === "handled") {
          rl.prompt();
          return;
        }
      }

      // Run agent loop
      agentAbortController = new AbortController();
      try {
        await runAgentLoop(provider, input, history, display, config, {
          signal: agentAbortController.signal,
        });
      } catch (err) {
        display.onError((err as Error).message);
      } finally {
        agentAbortController = null;
      }

      console.log();
      rl.prompt();
    });

    rl.on("close", () => {
      // Only exit if this is the active readline (not being replaced by setup)
    });
  }

  startListening();
}
