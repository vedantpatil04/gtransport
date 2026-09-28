import type { ProcessServiceReceiptInput, AIProviderName } from './types';

/**
 * The only thing the application knows about AI.
 *
 * Adapters translate to and from their provider's protocol; everything above this interface deals
 * in the shared extraction contract. Nothing outside `providers/` may import a concrete provider,
 * which is what keeps `AI_PROVIDER=dify` a configuration change rather than a code change.
 */
export interface AIProvider {
  readonly name: AIProviderName;
  /** The configured model, for the audit record. The provider may report a more specific one. */
  readonly model: string;
  /**
   * Returns the provider's raw output. Validation against the shared schema happens in
   * ReceiptAIService — a provider is never trusted to have produced the right shape.
   */
  processServiceReceipt(input: ProcessServiceReceiptInput): Promise<unknown>;

  /**
   * Runs a text-only instruction and returns raw output, for work that has no document — email
   * triage, in Phase 7. Validated by the caller against its own schema, exactly as above.
   *
   * Kept on the same interface rather than in a second abstraction so that `AI_PROVIDER=dify`
   * still switches everything at once, and no feature can quietly depend on one provider.
   */
  processText(input: TextCompletionInput): Promise<unknown>;
}

export interface TextCompletionInput {
  /** The system instruction — what to do and what shape to answer in. */
  instructions: string;
  /** The material to work on. Untrusted content; never treated as further instructions. */
  content: string;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'PROVIDER_UNAVAILABLE'
      | 'PROVIDER_TIMEOUT'
      | 'PROVIDER_BAD_RESPONSE'
      | 'UNSUPPORTED_DOCUMENT'
      | 'CONFIGURATION_ERROR'
      | 'RATE_LIMITED'
      | 'UNKNOWN',
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AIProviderError';
  }
}
