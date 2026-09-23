import type { Employee, UserRole } from '@prisma/client';
import { canSeePayroll } from '../auth/roles';

export interface EmployeeView {
  id: string;
  employeeCode: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  role: string;
  designation: string | null;
  department: string | null;
  preferredLanguage: string;
  status: string;
  dateOfBirth: string | null;
  joiningDate: string | null;
  exitDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  driver?: { id: string; driverCode: string; status: string } | null;
  payroll?: { baseSalary: string | null; pfApplicable: boolean; uan: string | null; pfMemberId: string | null };
}

export const isoDate = (value: Date | null): string | null => (value ? value.toISOString().slice(0, 10) : null);

export type EmployeeWithDriver = Employee & {
  driver?: { id: string; driverCode: string; status: string } | null;
};

/** Payroll figures are omitted entirely for roles that may not see them. */
export function presentEmployee(employee: EmployeeWithDriver, viewerRole: UserRole): EmployeeView {
  return {
    id: employee.id,
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    phone: employee.phone,
    email: employee.email,
    role: employee.role,
    designation: employee.designation,
    department: employee.department,
    preferredLanguage: employee.preferredLanguage,
    status: employee.status,
    dateOfBirth: isoDate(employee.dateOfBirth),
    joiningDate: isoDate(employee.joiningDate),
    exitDate: isoDate(employee.exitDate),
    notes: employee.notes,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
    driver: employee.driver ?? null,
    ...(canSeePayroll(viewerRole)
      ? {
          payroll: {
            baseSalary: employee.baseSalary?.toFixed(2) ?? null,
            pfApplicable: employee.pfApplicable,
            uan: employee.uan,
            pfMemberId: employee.pfMemberId,
          },
        }
      : {}),
  };
}
