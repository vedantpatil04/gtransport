import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { ReceiptWorkerService } from './receipt-worker.service';

/**
 * Keeps the queue moving without anyone waiting on it.
 *
 * A driver photographing a bill at a garage on a 3G connection must not sit through a
 * sixty-second model call (§15). The upload therefore returns as soon as the file is stored and
 * the job is written; this dispatcher drains the queue afterwards, in the background.
 *
 * ── Why a poll and not a broker ──
 *
 * The jobs already live in PostgreSQL, and `claimNext` already handles concurrent claiming, crash
 * recovery and backoff. Adding Redis and BullMQ would move the queue, not improve it, and would
 * add a service to operate for a workload of a few receipts a day (§15: a modular monolith with a
 * background mechanism is acceptable; no unnecessary microservices).
 *
 * The poll is cheap — one indexed query per tick against a small table — and it self-adjusts:
 * after a tick that found work it comes straight back, because a queue with one job usually has
 * several.
 *
 * ── Running it elsewhere ──
 *
 * `AI_WORKER_ENABLED=false` turns this off, for a deployment that would rather run the drain from
 * `npm run ai:worker` on a schedule, or on a machine separate from the API. The jobs are in the
 * database either way; nothing about the queue assumes this dispatcher is the thing draining it.
 */
@Injectable()
export class ReceiptDispatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReceiptDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly worker: ReceiptWorkerService,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const { workerEnabled, workerPollSeconds } = this.config.ai;
    if (!workerEnabled) {
      this.logger.log('Receipt AI worker is disabled in this process (AI_WORKER_ENABLED=false).');
      return;
    }
    this.logger.log(`Receipt AI worker polling every ${workerPollSeconds}s.`);
    this.schedule(workerPollSeconds * 1_000);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
    // Never hold the process open: a pending poll must not stop the API shutting down cleanly.
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) return;
    this.running = true;

    let processed = 0;
    try {
      processed = await this.worker.drain(this.config.ai.workerBatchSize);
    } catch (error) {
      // Reaching here means the claim query itself failed — the database is unreachable. Log and
      // carry on; the next tick tries again, and the jobs are still safely queued.
      this.logger.error('Receipt AI worker tick failed', error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
      // Work usually arrives in clusters, so a productive tick comes straight back for more.
      this.schedule(processed > 0 ? 250 : this.config.ai.workerPollSeconds * 1_000);
    }
  }

  /** Runs one drain immediately. Used by the standalone worker script and by tests. */
  async runOnce(max?: number): Promise<number> {
    return this.worker.drain(max ?? this.config.ai.workerBatchSize);
  }
}
