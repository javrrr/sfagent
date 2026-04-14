/**
 * Interactive REPL — readline-based terminal interface.
 */

import * as readline from "node:readline";
import chalk from "chalk";
import type { Message, SfAgentConfig } from "./api/types.js";
import type { LLMProvider } from "./api/modelsClient.js";
import { SalesforceModelsProvider } from "./api/modelsClient.js";
import { loginWithSfCli, getOrgInfo } from "./api/auth.js";
import { runSetup } from "./setup.js";
import { runAgentLoop } from "./agent.js";
import { createDisplay } from "./ui/display.js";

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

async function handleSlashCommand(
  input: string,
  provider: LLMProvider,
  history: Message[],
  config: SfAgentConfig,
  rl: readline.Interface
): Promise<boolean> {
  const [cmd, ...rest] = input.trim().split(/\s+/);

  switch (cmd) {
    case "/exit":
    case "/quit":
      console.log(chalk.dim("Goodbye."));
      process.exit(0);

    case "/clear":
      history.length = 0;
      console.log(chalk.dim("Conversation cleared."));
      return true;

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
      return true;
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
      return true;
    }

    case "/setup": {
      try {
        await runSetup(config, rl);
        // Reload credentials into config
        const { loadCredentials } = await import("./api/auth.js");
        config.credentials = await loadCredentials();
      } catch (err) {
        console.log(chalk.red((err as Error).message));
      }
      return true;
    }

    case "/org": {
      const orgInfo = getOrgInfo(config.targetOrg || undefined);
      if (Object.keys(orgInfo).length === 0) {
        console.log(chalk.dim("No org info available. Run /login first."));
      } else {
        for (const [key, value] of Object.entries(orgInfo)) {
          if (value) console.log(chalk.dim(`  ${key}: ${value}`));
        }
      }
      return true;
    }

    case "/history":
      console.log(
        chalk.dim(`${history.length} messages in conversation history.`)
      );
      return true;

    case "/help":
      console.log(
        chalk.dim(`
Available commands:
  /setup           Configure Models API credentials (first-time setup)
  /login [alias]   Log in to a Salesforce org via sf CLI
  /org             Show current org details
  /model [name]    Show or set the current model
  /clear           Clear conversation history
  /history         Show message count
  /help            Show this help
  /exit            Exit sfagent
`)
      );
      return true;

    default:
      return false;
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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("sfagent> "),
  });

  const display = createDisplay(rl);

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // Handle slash commands
    if (input.startsWith("/")) {
      if (await handleSlashCommand(input, provider, history, config, rl)) {
        rl.prompt();
        return;
      }
    }

    // Run agent loop
    try {
      await runAgentLoop(provider, input, history, display, config);
    } catch (err) {
      display.onError((err as Error).message);
    }

    console.log();
    rl.prompt();
  });

  rl.on("close", () => {
    console.log(chalk.dim("\nGoodbye."));
    process.exit(0);
  });
}
