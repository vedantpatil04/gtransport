import type { UserRole } from '@prisma/client';
import { canSeePayroll } from '../auth/roles';
import type { DriverRow } from './drivers.service';

export interface DriverView {
  id: string;
  driverCode: string;
  status: string;
  licenceNumber: string | null;
  licenceExpiryDate: string | null;
  homeTown: string | null;
  locationSharingEnabled: boolean;
  /** Foundation only: real tracking arrives in the location phase. */
  location: { status: string; permission: string; lastHeartbeatAt: string | null } | null;
  emergencyContact: { name: string | null; phone: string | null };
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    designation: string | null;
    department: string | null;
    preferredLanguage: string;
    status: string;
    joiningDate: string | null;
  };
  currentAssignment: {
    id: string;
    startedAt: string;
    vehicle: { id: string; registrationNumber: string; kind: string; fuelType: string; status: string; ownership: string };
  } | null;
  pf?: { applicable: boolean; uan: string | null; memberId: string | null; baseSalary: string | null };
}

const isoDate = (value: Date | null): string | null => (value ? value.toISOString().slice(0, 10) : null);

export function presentDriver(driver: DriverRow, viewerRole: UserRole): DriverView {
  return {
    id: driver.id,
    driverCode: driver.driverCode,
    status: driver.status,
    licenceNumber: driver.licenceNumber,
    licenceExpiryDate: isoDate(driver.licenceExpiryDate),
    homeTown: driver.homeTown,
    locationSharingEnabled: driver.locationSharingEnabled,
    location: driver.locationState
      ? {
          status: driver.locationState.status,
          permission: driver.locationState.permission,
          lastHeartbeatAt: driver.locationState.lastHeartbeatAt?.toISOString() ?? null,
        }
      : null,
    emergencyContact: { name: driver.emergencyContactName, phone: driver.emergencyContactPhone },
    employee: {
      id: driver.employee.id,
      employeeCode: driver.employee.employeeCode,
      fullName: driver.employee.fullName,
      phone: driver.employee.phone,
      email: driver.employee.email,
      designation: driver.employee.designation,
      department: driver.employee.department,
      preferredLanguage: driver.employee.preferredLanguage,
      status: driver.employee.status,
      joiningDate: isoDate(driver.employee.joiningDate),
    },
    currentAssignment: driver.currentAssignment
      ? {
          id: driver.currentAssignment.id,
          startedAt: driver.currentAssignment.startedAt.toISOString(),
          vehicle: driver.currentAssignment.vehicle,
        }
      : null,
    // PF and salary are payroll data: withheld from roles that may not see them.
    ...(canSeePayroll(viewerRole)
      ? {
          pf: {
            applicable: driver.employee.pfApplicable,
            uan: driver.employee.uan,
            memberId: driver.employee.pfMemberId,
            baseSalary: driver.employee.baseSalary?.toFixed(2) ?? null,
          },
        }
      : {}),
  };
}
