/**
 * Salesforce Models API client.
 *
 * Uses JWT tokens from the client_credentials flow
 * to call the Models API at api.salesforce.com.
 */

import type {
  Message,
  ModelsRequest,
  ModelsResponse,
  SfAgentConfig,
} from "./types.js";
import { MODELS_API_BASE, DEFAULT_MODEL } from "./types.js";
import { getModelsApiToken, clearCachedToken } from "./auth.js";

// ---------------------------------------------------------------------------
// LLM Provider interface — swap this when the Models API adds tool use
// ---------------------------------------------------------------------------

export interface LLMResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model: string;
}

export interface LLMProvider {
  chat(messages: Message[]): Promise<LLMResponse>;
}

// ---------------------------------------------------------------------------
// Salesforce Models API provider
// ---------------------------------------------------------------------------

export class SalesforceModelsProvider implements LLMProvider {
  private config: SfAgentConfig;
  private model: string;

  constructor(config: SfAgentConfig) {
    this.config = config;
    this.model = config.model || DEFAULT_MODEL;
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  async chat(messages: Message[]): Promise<LLMResponse> {
    return this.sendWithRetry(messages, /* retried */ false);
  }

  private async sendWithRetry(
    messages: Message[],
    retried: boolean
  ): Promise<LLMResponse> {
    const token = await getModelsApiToken(this.config);

    const requestBody: ModelsRequest = {
      messages,
      localization: {
        defaultLocale: "en_US",
        expectedLocales: ["en_US"],
      },
    };

    const url = `${MODELS_API_BASE}/models/${encodeURIComponent(this.model)}/chat-generations`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "Content-Type": "application/json;charset=utf-8",
        "x-sfdc-app-context": "EinsteinGPT",
        "x-client-feature-id": "ai-platform-models-connected-app",
      },
      body: JSON.stringify(requestBody),
    });

    // Retry once on 401 with a fresh token
    if (res.status === 401 && !retried) {
      clearCachedToken();
      return this.sendWithRetry(messages, true);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Models API error (${res.status}): ${text}`);
    }

    const data = await res.json();

    // chat-generations wraps in generationDetails; generations uses generation
    const generationDetails = data.generationDetails ?? data;
    const generation =
      generationDetails.generations?.[0] ?? data.generation ?? null;

    if (!generation) {
      throw new Error(
        "Models API returned no generations: " +
          JSON.stringify(data).slice(0, 200)
      );
    }

    const content =
      generation.content ?? generation.generatedText ?? "";

    // Usage can be in multiple places depending on the endpoint/model
    const params =
      generationDetails.parameters ?? data.parameters ?? {};
    const usage =
      params.usage ??
      generation.usage ??
      data.usage ??
      {};

    return {
      content,
      usage: {
        inputTokens:
          usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens ?? 0,
        outputTokens:
          usage.completion_tokens ??
          usage.output_tokens ??
          usage.outputTokens ??
          0,
        totalTokens:
          usage.total_tokens ?? usage.totalTokens ?? 0,
      },
      model: params.model ?? this.model,
    };
  }
}
