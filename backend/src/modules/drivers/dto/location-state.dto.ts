import { LocationPermission } from '@prisma/client';
import { IsBoolean, IsEnum } from 'class-validator';

/**
 * What the driver app reports about the phone's location permissions. Deliberately carries no
 * coordinates: position reporting belongs to the tracking phase, and the app must not be able
 * to assert that tracking is working when the OS has denied it.
 */
export class ReportLocationStateDto {
  @IsEnum(LocationPermission)
  permission!: LocationPermission;

  /** The device-level location services toggle. */
  @IsBoolean()
  locationServicesEnabled!: boolean;
}
