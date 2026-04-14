# sfagent

A terminal agent for Salesforce developers — powered by the [Salesforce Models API](https://developer.salesforce.com/docs/einstein/genai/guide/models-api.html).

Think of it as a Claude Code-like experience for building on Salesforce: query data, deploy metadata, run Apex, and manage orgs — all from your terminal with AI assistance.

## Install

```bash
npm install -g sfagent
```

## Quick Start

```bash
sfagent --setup   # first-time: configure Models API credentials
sfagent           # start the agent
```

Or without installing:

```bash
npx sfagent
```

## Prerequisites

1. **Node.js 20+**
2. **Salesforce CLI** installed and authenticated:
   ```bash
   npm install -g @salesforce/cli
   sf org login web --set-default
   ```
3. **Agentforce** enabled on your Salesforce org

## Setup

On first run, configure the Models API connection:

```bash
sfagent --setup
```

This walks you through:
1. Selecting your Salesforce org
2. Creating an External Client App (with step-by-step instructions)
3. Entering your Consumer Key and Secret
4. Testing the connection

Credentials are stored locally in `~/.sfagent/credentials.json`.

### External Client App Settings

When creating the app in Salesforce Setup:

**OAuth Scopes:**
- Manage user data via APIs (`api`)
- Perform requests at any time (`refresh_token`, `offline_access`)
- Access the Salesforce API Platform (`sfap_api`)

**Policies Tab:**
- Enable Client Credentials Flow ✓
- Set a Run As user
- Issue JWT-based access tokens ✓

## Usage

```bash
# Start the agent
sfagent

# Use a specific model
SF_MODEL=sfdc_ai__DefaultBedrockAnthropicClaude45Sonnet sfagent

# Target a specific org
SF_TARGET_ORG=my-sandbox sfagent
```

### Example Interactions

```
sfagent> Query the first 5 accounts by revenue
sfagent> Show me my connected orgs
sfagent> Deploy the force-app directory to my sandbox
sfagent> Run this Apex: System.debug(UserInfo.getUserName());
sfagent> Read the Account trigger and add a validation
```

### Commands

| Command | Description |
|---------|-------------|
| `/setup` | Configure Models API credentials |
| `/login [alias]` | Log in to a Salesforce org via sf CLI |
| `/org` | Show current org details |
| `/model [name]` | Show or change the AI model |
| `/clear` | Clear conversation history |
| `/help` | Show all commands |
| `/exit` | Exit sfagent |

## Tools

sfagent has 7 built-in tools the AI can use:

| Tool | Read-only | Description |
|------|-----------|-------------|
| `file_read` | ✓ | Read local project files |
| `soql_query` | ✓ | Execute SOQL queries with formatted tables |
| `org_info` | ✓ | Display/list connected orgs |
| `file_edit` | | Search-and-replace file edits |
| `sf_cli` | | Run any `sf` command |
| `deploy` | | Deploy metadata to an org |
| `apex_run` | | Execute anonymous Apex |

Non-read-only tools require confirmation before executing. You can approve individually or allow all for the session.

## Supported Models

Any model available through the [Salesforce Models API](https://developer.salesforce.com/docs/einstein/genai/guide/supported-models.html):

| Model | API Name |
|-------|----------|
| Claude Sonnet 4 (default) | `sfdc_ai__DefaultBedrockAnthropicClaude4Sonnet` |
| Claude Sonnet 4.5 | `sfdc_ai__DefaultBedrockAnthropicClaude45Sonnet` |
| Claude Haiku 4.5 | `sfdc_ai__DefaultBedrockAnthropicClaude45Haiku` |
| GPT-4o | `sfdc_ai__DefaultGPT4Omni` |
| Gemini 2.5 Pro | `sfdc_ai__DefaultVertexAIGeminiPro25` |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SF_MODEL` | `sfdc_ai__DefaultBedrockAnthropicClaude4Sonnet` | Model API name |
| `SF_TARGET_ORG` | *(auto-detected)* | Org alias or username |

## How It Works

sfagent uses prompt-engineered tool use over the Salesforce Models API. The AI model receives tool descriptions in the system prompt and outputs structured `<tool_call>` blocks when it needs to perform actions. The harness parses these, executes the tools locally via the Salesforce CLI, and feeds results back to the model.

```
User input → Models API (LLM) → Tool calls → sf CLI execution → Results → LLM → Response
```

## License

MIT
