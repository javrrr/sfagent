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
import chalk from "chalk";
import type { StoredCredentials, SfAgentConfig } from "./api/types.js";
import {
  saveCredentials,
  loadCredentials,
  getMyDomain,
  listConnectedOrgs,
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
  config: SfAgentConfig,
  existingRl?: readline.Interface
): Promise<void> {
  const rl =
    existingRl ??
    readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(chalk.cyan("\n  ╔══════════════════════════════════════╗"));
    console.log(chalk.cyan("  ║    sfagent — Models API Setup        ║"));
    console.log(chalk.cyan("  ╚══════════════════════════════════════╝\n"));

    // Check existing credentials
    const existing = await loadCredentials();
    if (existing) {
      const overwrite = await ask(
        rl,
        chalk.yellow("  Credentials already exist. Overwrite? (y/N): ")
      );
      if (overwrite.toLowerCase() !== "y") {
        console.log(chalk.dim("  Setup cancelled.\n"));
        return;
      }
    }

    // Step 1: Choose org
    console.log(chalk.white.bold("  Step 1: Select your Salesforce org\n"));

    const orgs = listConnectedOrgs();
    let myDomain: string | null = null;

    if (orgs.length > 0) {
      orgs.forEach((org, i) => {
        const label = org.alias ? `${org.alias} (${org.username})` : org.username;
        const def = org.isDefault ? chalk.green(" ← default") : "";
        console.log(`    ${chalk.cyan(`${i + 1})`)} ${label}${def}`);
        console.log(chalk.dim(`       ${org.instanceUrl}`));
      });

      const choice = await ask(
        rl,
        chalk.cyan(`\n  Select org [1-${orgs.length}]: `)
      );

      const idx = parseInt(choice, 10) - 1;
      if (idx >= 0 && idx < orgs.length) {
        const selectedOrg = orgs[idx]!;
        myDomain = selectedOrg.instanceUrl;
        const label = selectedOrg.alias
          ? `${selectedOrg.alias} (${selectedOrg.username})`
          : selectedOrg.username;
        console.log(chalk.green(`  ✓ ${label}`));
      } else {
        console.log(chalk.red("  Invalid choice."));
        myDomain = null;
      }
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
    // Only close if we created it
    if (!existingRl) rl.close();
  }
}

/**
 * Quick check: are credentials configured?
 */
export async function hasCredentials(): Promise<boolean> {
  const creds = await loadCredentials();
  return creds !== null;
}
