import { Logger, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { AI_PROVIDER } from './ai.tokens';
import { createAIProvider } from './factory';
import type { AIProvider } from './provider';
import { ReceiptAIService } from './receipt-ai.service';

/**
 * Receipt AI boundary. Registers the configured provider (Ollama by default, Dify optional)
 * behind AI_PROVIDER. Phase 0 exposes no endpoints and performs no inference; later phases
 * call ReceiptAIService from the receipt worker.
 */
@Module({
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): AIProvider => {
        const provider = createAIProvider(config.ai);
        new Logger('AiModule').log(`Receipt AI provider: ${provider.name}`);
        return provider;
      },
    },
    ReceiptAIService,
  ],
  exports: [ReceiptAIService],
})
export class AiModule {}
