import { Module } from '@nestjs/common';
import { AssignmentsModule } from '../assignments/assignments.module';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';

@Module({
  imports: [AssignmentsModule],
  controllers: [DriversController],
  providers: [DriversService],
  exports: [DriversService],
})
export class DriversModule {}
