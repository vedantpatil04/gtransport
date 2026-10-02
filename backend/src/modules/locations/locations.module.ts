import { Module } from '@nestjs/common';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { LocationConfigService } from './location.config';
import { LocationIngestThrottle } from './ingest-throttle';
import { LocationRetentionService } from './location-retention.service';
import { LocationRetentionScheduler } from './location-retention.scheduler';

/**
 * Driver location domain: ingestion from the driver app, the current-location read model behind
 * Live Fleet, append-only history, and server-side stationary alerting.
 *
 * Status derivation lives in location-status.policy.ts and the stationary rule in
 * stationary-engine.ts — both pure, so the behaviour the fleet depends on is tested without a
 * database or an HTTP stack.
 */
@Module({
  controllers: [LocationsController],
  providers: [
    LocationsService,
    LocationConfigService,
    LocationIngestThrottle,
    LocationRetentionService,
    LocationRetentionScheduler,
  ],
  exports: [LocationsService, LocationConfigService, LocationRetentionService, LocationRetentionScheduler],
})
export class LocationsModule {}
