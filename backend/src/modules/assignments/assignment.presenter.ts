import type { Driver, Employee, Vehicle, VehicleAssignment } from '@prisma/client';

export type AssignmentWithParties = VehicleAssignment & {
  vehicle?: Pick<Vehicle, 'id' | 'registrationNumber' | 'kind'> | null;
  driver?: (Pick<Driver, 'id' | 'driverCode'> & { employee: Pick<Employee, 'fullName' | 'phone'> }) | null;
};

export interface AssignmentView {
  id: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  notes: string | null;
  isCurrent: boolean;
  vehicle: { id: string; registrationNumber: string; kind: string } | null;
  driver: { id: string; driverCode: string; fullName: string; phone: string | null } | null;
}

export function presentAssignment(assignment: AssignmentWithParties): AssignmentView {
  return {
    id: assignment.id,
    startedAt: assignment.startedAt.toISOString(),
    endedAt: assignment.endedAt?.toISOString() ?? null,
    endReason: assignment.endReason,
    notes: assignment.notes,
    isCurrent: assignment.endedAt === null,
    vehicle: assignment.vehicle
      ? { id: assignment.vehicle.id, registrationNumber: assignment.vehicle.registrationNumber, kind: assignment.vehicle.kind }
      : null,
    driver: assignment.driver
      ? {
          id: assignment.driver.id,
          driverCode: assignment.driver.driverCode,
          fullName: assignment.driver.employee.fullName,
          phone: assignment.driver.employee.phone,
        }
      : null,
  };
}
