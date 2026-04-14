#!/usr/bin/env node
/**
 * sfagent — Salesforce terminal agent powered by the Models API.
 *
 * Usage:
 *   npx sfagent              # interactive mode
 *   npx sfagent --setup      # run setup wizard
 *
 * Prerequisites:
 *   1. Salesforce CLI installed:  npm install -g @salesforce/cli
 *   2. Logged in to an org:       sf org login web --set-default
 *   3. Run /setup to configure the External Client App
 */

import { loadConfig, getOrgInfo } from "./api/auth.js";
import { SalesforceModelsProvider } from "./api/modelsClient.js";
import { startRepl } from "./repl.js";
import { runSetup, hasCredentials } from "./setup.js";
import chalk from "chalk";

async function main(): Promise<void> {
  // Load config (checks sf CLI is installed, resolves org)
  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  // --setup flag: run setup wizard directly
  if (process.argv.includes("--setup")) {
    await runSetup(config);
    return;
  }

  // Show org info
  if (config.targetOrg) {
    const orgInfo = getOrgInfo(config.targetOrg);
    const orgLabel = orgInfo.alias || orgInfo.username || config.targetOrg;
    console.log(chalk.dim(`Org: ${orgLabel} (${orgInfo.instanceUrl || "unknown"})`));
  }

  // Check if credentials are configured
  const hasCreds = await hasCredentials();
  if (!hasCreds) {
    console.log(
      chalk.yellow("\n  ⚠ Models API not configured yet.") +
        chalk.dim(" Run /setup to get started.\n")
    );
  }

  // Create LLM provider
  const provider = new SalesforceModelsProvider(config);

  // Start interactive REPL
  await startRepl(provider, config);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
