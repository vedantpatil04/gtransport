import { Module } from '@nestjs/common';

/**
 * Driver location domain. The data model (current state, heartbeat, permission state,
 * history) exists in Prisma; background tracking, ingestion endpoints and the stationary
 * alert engine are later phases. Status derivation lives in location-status.policy.ts.
 */
@Module({})
export class LocationsModule {}
