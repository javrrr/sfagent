/**
 * Interactive setup wizard for the Models API.
 *
 * Guides the user through:
 * 1. Creating an External Client App in Salesforce Setup
 * 2. Configuring OAuth scopes and client credentials flow
 * 3. Pasting the consumer key + secret
 * 4. Verifying the connection with a test token request
 *
 * Stores credentials in ~/.sfagent/credentials.json
 */

import * as readline from "node:readline";
import select from "@inquirer/select";
import chalk from "chalk";
import type { StoredCredentials, SfAgentConfig } from "./api/types.js";
import {
  saveCredentials,
  loadCredentials,
  getMyDomain,
  listConnectedOrgs,
  loginWithSfCli,
} from "./api/auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function testCredentials(creds: StoredCredentials): Promise<boolean> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.consumerKey,
    client_secret: creds.consumerSecret,
  });

  try {
    const res = await fetch(`${creds.myDomain}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.access_token) return true;
    }

    const text = await res.text();
    console.log(chalk.red(`\n  Token request failed (${res.status}): ${text}`));
    return false;
  } catch (err) {
    console.log(chalk.red(`\n  Connection error: ${(err as Error).message}`));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Setup wizard
// ---------------------------------------------------------------------------

export async function runSetup(
  config: SfAgentConfig
): Promise<void> {
  // Setup manages its own readline instances since it needs to
  // hand stdin to inquirer for the org picker.
  let rl: readline.Interface | null = null;

  try {
    console.log(chalk.cyan("\n  ╔══════════════════════════════════════╗"));
    console.log(chalk.cyan("  ║    sfagent — Models API Setup        ║"));
    console.log(chalk.cyan("  ╚══════════════════════════════════════╝\n"));

    // Check existing credentials (use a temporary readline)
    const existing = await loadCredentials();
    if (existing) {
      const tmpRl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const overwrite = await ask(
        tmpRl,
        chalk.yellow("  Credentials already exist. Overwrite? (y/N): ")
      );
      tmpRl.close();
      if (overwrite.toLowerCase() !== "y") {
        console.log(chalk.dim("  Setup cancelled.\n"));
        return;
      }
    }

    // Step 1: Choose how to connect
    console.log(chalk.white.bold("  Step 1: Connect to a Salesforce org\n"));

    let myDomain: string | null = null;

    // Screen 1: Pick connection method
    let method: string;
    try {
      method = await select({
        message: "How would you like to connect?",
        choices: [
          { name: "Use an existing SF CLI org", value: "existing" },
          { name: "Log in to a new org (opens browser)", value: "login" },
          { name: "Enter My Domain URL manually", value: "manual" },
        ],
      });
    } catch {
      console.log(chalk.dim("\n  Setup cancelled.\n"));
      return;
    }

    if (method === "existing") {
      // Screen 2: Pick from connected orgs
      const orgs = listConnectedOrgs();

      if (orgs.length === 0) {
        console.log(chalk.yellow("\n  No connected orgs found."));
        console.log(chalk.dim("  Run: sf org login web --set-default\n"));
      } else {
        const orgChoices = orgs.map((org) => {
          const label = org.alias
            ? `${org.alias} (${org.username})`
            : org.username;
          const def = org.isDefault ? chalk.green(" ← default") : "";
          return {
            name: `${label}${def}  ${chalk.dim(org.instanceUrl)}`,
            value: org.instanceUrl,
          };
        });

        try {
          myDomain = await select({
            message: "Select org",
            choices: orgChoices,
          });
          const matchedOrg = orgs.find((o) => o.instanceUrl === myDomain);
          if (matchedOrg) {
            const label = matchedOrg.alias
              ? `${matchedOrg.alias} (${matchedOrg.username})`
              : matchedOrg.username;
            console.log(chalk.green(`  ✓ ${label}`));
          }
        } catch {
          console.log(chalk.dim("\n  Setup cancelled.\n"));
          return;
        }
      }
    } else if (method === "login") {
      // Create readline for the alias prompt
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const alias = await ask(
        rl,
        chalk.cyan("\n  Org alias (optional, press Enter to skip): ")
      );
      rl.close();
      rl = null;

      try {
        loginWithSfCli(alias || undefined);
        const orgs = listConnectedOrgs();
        const newOrg = alias
          ? orgs.find((o) => o.alias === alias)
          : orgs[orgs.length - 1];
        if (newOrg) {
          myDomain = newOrg.instanceUrl;
          const label = newOrg.alias
            ? `${newOrg.alias} (${newOrg.username})`
            : newOrg.username;
          console.log(chalk.green(`  ✓ ${label}`));
        }
      } catch (err) {
        console.log(chalk.red(`  Login failed: ${(err as Error).message}`));
      }
    }
    // method === "manual" falls through

    // Create readline for remaining prompts (if not already open)
    if (!rl) {
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    }

    if (!myDomain) {
      const manualDomain = await ask(
        rl,
        chalk.cyan("\n  Enter your My Domain URL (e.g. https://mycompany.my.salesforce.com): ")
      );
      if (!manualDomain) {
        console.log(chalk.red("  My Domain URL is required. Setup cancelled.\n"));
        return;
      }
      myDomain = manualDomain.replace(/\/+$/, "");
    }

    // Step 2: Instructions for creating External Client App
    console.log(chalk.white.bold("\n  Step 2: Create an External Client App\n"));
    console.log(chalk.dim(`  In your org (${myDomain}):`));
    console.log(chalk.dim("  1. Setup → search \"External Client App\""));
    console.log(chalk.dim("  2. New External Client App"));
    console.log(chalk.dim("  3. Name: sfagent, Enable OAuth ✓"));
    console.log(chalk.dim("  4. Callback URL: http://localhost:8439/callback"));
    console.log(chalk.dim("  5. Scopes: api, refresh_token, sfap_api"));
    console.log(chalk.dim("  6. Save\n"));

    console.log(chalk.white.bold("  Step 3: Enable Client Credentials Flow\n"));
    console.log(chalk.dim("  On the app's Policies tab:"));
    console.log(chalk.dim("  1. Enable Client Credentials Flow ✓"));
    console.log(chalk.dim("  2. Set a Run As user"));
    console.log(chalk.dim("  3. Issue JWT-based access tokens ✓"));
    console.log(chalk.dim("  4. Save\n"));

    await ask(rl, chalk.cyan("  Press Enter when done..."));

    // Step 4: Collect credentials
    console.log(chalk.white.bold("\n  Step 4: Enter your credentials\n"));
    console.log(
      chalk.dim(
        "  Find these under: App Settings → OAuth Settings → Consumer Key and Secret\n"
      )
    );

    const consumerKey = await ask(rl, chalk.cyan("  Consumer Key: "));
    if (!consumerKey) {
      console.log(chalk.red("  Consumer Key is required. Setup cancelled.\n"));
      return;
    }

    const consumerSecret = await ask(rl, chalk.cyan("  Consumer Secret: "));
    if (!consumerSecret) {
      console.log(chalk.red("  Consumer Secret is required. Setup cancelled.\n"));
      return;
    }

    const creds: StoredCredentials = {
      consumerKey,
      consumerSecret,
      myDomain,
    };

    // Step 5: Test the credentials
    console.log(chalk.dim("\n  Testing credentials..."));
    const success = await testCredentials(creds);

    if (success) {
      console.log(chalk.green("  ✓ Authentication successful!"));
    } else {
      console.log(
        chalk.yellow(
          "\n  Authentication test failed. Saving credentials anyway.\n" +
            "  Common issues:\n" +
            "  - Client Credentials Flow not enabled on the app\n" +
            "  - Run As user not set in the Policies tab\n" +
            "  - Missing sfap_api scope\n" +
            "  - App was just created (may take a few minutes to propagate)\n"
        )
      );
      const saveAnyway = await ask(
        rl,
        chalk.cyan("  Save credentials anyway? (Y/n): ")
      );
      if (saveAnyway.toLowerCase() === "n") {
        console.log(chalk.dim("  Setup cancelled.\n"));
        return;
      }
    }

    // Save
    await saveCredentials(creds);
    console.log(chalk.green("  ✓ Credentials saved to .sfagent/credentials.json\n"));
    console.log(chalk.yellow("  ⚠ Add .sfagent/ to your .gitignore to avoid committing secrets.\n"));
    console.log(chalk.dim("  You're all set! Start chatting to use the Models API.\n"));
  } finally {
    if (rl) rl.close();
  }
}

/**
 * Quick check: are credentials configured?
 */
export async function hasCredentials(): Promise<boolean> {
  const creds = await loadCredentials();
  return creds !== null;
}
