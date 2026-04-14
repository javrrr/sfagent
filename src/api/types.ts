/**
 * Salesforce Models API type definitions.
 */

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

// ---------------------------------------------------------------------------
// Models API Request / Response
// ---------------------------------------------------------------------------

export interface ModelsRequest {
  messages: Message[];
  localization?: {
    defaultLocale: string;
    inputLocales?: Array<{ locale: string; probability: number }>;
    expectedLocales?: string[];
  };
  tags?: Record<string, string>;
}

export interface GenerationEntry {
  id: string;
  role: string;
  content: string;
  timestamp?: number;
  parameters?: {
    finish_reason: string;
    index: number;
    logprobs: unknown;
  };
  contentQuality?: {
    scanToxicity?: {
      isDetected: boolean;
      categories: Array<{ categoryName: string; score: number }>;
    };
  };
}

export interface ModelsResponse {
  id: string;
  generationDetails: {
    generations: GenerationEntry[];
    parameters: {
      created: number;
      usage: {
        completion_tokens: number;
        prompt_tokens: number;
        total_tokens: number;
      };
      model: string;
      object: string;
    };
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** JWT returned by the client_credentials token exchange. */
export interface AuthToken {
  access_token: string;
  instance_url: string;
  api_instance_url?: string;
  token_type: string;
  issued_at: string;
  scope?: string;
  expires_at?: number;
}

/** Stored credentials for the External Client App. */
export interface StoredCredentials {
  consumerKey: string;
  consumerSecret: string;
  myDomain: string;
  model?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SfAgentConfig {
  /** Stored credentials from setup. */
  credentials: StoredCredentials | null;
  /** Target org alias (for sf CLI operations like deploy, query). */
  targetOrg: string;
  /** Model API name. */
  model: string;
}

export const DEFAULT_MODEL = "sfdc_ai__DefaultBedrockAnthropicClaude4Sonnet";

export const MODELS_API_BASE = "https://api.salesforce.com/einstein/platform/v1";
