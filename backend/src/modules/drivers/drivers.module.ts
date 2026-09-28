import { Module } from '@nestjs/common';
import { AssignmentsModule } from '../assignments/assignments.module';
import { LocationsModule } from '../locations/locations.module';
import { UsersModule } from '../users/users.module';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';

@Module({
  imports: [AssignmentsModule, UsersModule, LocationsModule],
  controllers: [DriversController],
  providers: [DriversService],
  exports: [DriversService],
})
export class DriversModule {}
