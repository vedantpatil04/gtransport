/* eslint-disable no-console */
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AppLanguage, DriverStatus, EmployeeRole, EmploymentStatus, FinanceStatus, FuelType,
  PrismaClient, VehicleKind, VehicleOwnership, VehicleStatus,
} from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import { envFilePaths } from '../src/config/env-files';
import { calculateEmi, outstandingPrincipal } from '../src/modules/finance/emi.calculator';

loadEnv({ path: envFilePaths(), quiet: true });

/**
 * Development demo dataset for Phase 1: employees, driver profiles, vehicles, assignments
 * and vehicle financing. Names and registrations mirror the approved prototype's demo data,
 * so the admin screens look familiar once they are pointed at the real API.
 *
 * Idempotent and additive: it never deletes anything, and it skips records that already
 * exist, so it is safe to run repeatedly against a development database. It refuses to run
 * against NODE_ENV=production.
 */

interface EmployeeSpec {
  code: string;
  name: string;
  phone: string;
  role: EmployeeRole;
  designation?: string;
  department?: string;
  language: AppLanguage;
  status: EmploymentStatus;
  joinedDaysAgo: number;
  baseSalary: number;
  pf: { applicable: boolean; uan?: string; memberId?: string };
  driver?: {
    code: string;
    status: DriverStatus;
    licence: string;
    licenceExpiryInDays: number;
    homeTown: string;
    emergency: { name: string; phone: string };
  };
}

const EMPLOYEES: EmployeeSpec[] = [
  {
    code: 'GR-E-001', name: 'Ramesh Kumar', phone: '+919845012301', role: EmployeeRole.DRIVER,
    designation: 'Senior Driver', department: 'Operations', language: AppLanguage.EN,
    status: EmploymentStatus.ACTIVE, joinedDaysAgo: 1460, baseSalary: 18000,
    pf: { applicable: true, uan: '100200300401', memberId: 'BGBNG0012345001' },
    driver: {
      code: 'GR-D-101', status: DriverStatus.ACTIVE, licence: 'KA22 20110001234', licenceExpiryInDays: 540,
      homeTown: 'Belagavi', emergency: { name: 'Sunita Kumar', phone: '+919845012399' },
    },
  },
  {
    code: 'GR-E-002', name: 'Suresh Patil', phone: '+919845012302', role: EmployeeRole.DRIVER,
    designation: 'Driver', department: 'Operations', language: AppLanguage.KN,
    status: EmploymentStatus.ACTIVE, joinedDaysAgo: 980, baseSalary: 21000,
    pf: { applicable: true, uan: '100200300402', memberId: 'BGBNG0012345002' },
    driver: {
      code: 'GR-D-102', status: DriverStatus.ACTIVE, licence: 'KA22 20130004567', licenceExpiryInDays: 210,
      homeTown: 'Nipani', emergency: { name: 'Rekha Patil', phone: '+919845012398' },
    },
  },
  {
    code: 'GR-E-003', name: 'Mahesh Naik', phone: '+919845012303', role: EmployeeRole.DRIVER,
    designation: 'Driver', department: 'Operations', language: AppLanguage.KN,
    status: EmploymentStatus.ACTIVE, joinedDaysAgo: 640, baseSalary: 17500,
    pf: { applicable: false },
    driver: {
      code: 'GR-D-103', status: DriverStatus.ON_LEAVE, licence: 'KA22 20150007788', licenceExpiryInDays: 45,
      homeTown: 'Gokak', emergency: { name: 'Shilpa Naik', phone: '+919845012397' },
    },
  },
  {
    code: 'GR-E-004', name: 'Amit Pawar', phone: '+919845012304', role: EmployeeRole.DRIVER,
    designation: 'Driver', department: 'Operations', language: AppLanguage.MR,
    status: EmploymentStatus.ACTIVE, joinedDaysAgo: 2200, baseSalary: 22000,
    pf: { applicable: true, uan: '100200300404', memberId: 'BGBNG0012345004' },
    driver: {
      code: 'GR-D-104', status: DriverStatus.ACTIVE, licence: 'MH11 20090003311', licenceExpiryInDays: 900,
      homeTown: 'Satara', emergency: { name: 'Vaishali Pawar', phone: '+919845012396' },
    },
  },
  {
    code: 'GR-E-005', name: 'Ganesh Jadhav', phone: '+919845012305', role: EmployeeRole.DRIVER,
    designation: 'Driver', department: 'Operations', language: AppLanguage.MR,
    // Left the company: kept for history, and his old assignment stays on record.
    status: EmploymentStatus.INACTIVE, joinedDaysAgo: 1750, baseSalary: 20000,
    pf: { applicable: true, uan: '100200300405', memberId: 'BGBNG0012345005' },
    driver: {
      code: 'GR-D-105', status: DriverStatus.INACTIVE, licence: 'MH09 20120009900', licenceExpiryInDays: -30,
      homeTown: 'Kolhapur', emergency: { name: 'Manisha Jadhav', phone: '+919845012395' },
    },
  },
  {
    code: 'GR-E-006', name: 'Shobha Kulkarni', phone: '+919845012306', role: EmployeeRole.ACCOUNTING,
    designation: 'Accounts Executive', department: 'Accounts', language: AppLanguage.KN,
    status: EmploymentStatus.ACTIVE, joinedDaysAgo: 520, baseSalary: 28000,
    pf: { applicable: true, uan: '100200300406', memberId: 'BGBNG0012345006' },
  },
  {
    code: 'GR-E-007', name: 'Anil Deshpande', phone: '+919845012307', role: EmployeeRole.MANAGER,
    designation: 'Operations Manager', department: 'Operations', language: AppLanguage.MR,
    status: EmploymentStatus.ACTIVE, joinedDaysAgo: 3100, baseSalary: 42000,
    pf: { applicable: true, uan: '100200300407', memberId: 'BGBNG0012345007' },
  },
];

interface VehicleSpec {
  registration: string;
  make: string;
  model: string;
  variant?: string;
  kind: VehicleKind;
  fuelType: FuelType;
  year: number;
  capacityTonnes: number;
  mileageKmpl: number;
  status: VehicleStatus;
  ownership: VehicleOwnership;
  /** Driver code of the current driver, if any. */
  driverCode?: string;
  finance?: {
    lender: string;
    account: string;
    loanAmount: number;
    downPayment: number;
    startedDaysAgo: number;
    tenureMonths: number;
    ratePct: number;
    paidInstallments: number;
    status: FinanceStatus;
  };
}

const VEHICLES: VehicleSpec[] = [
  {
    registration: 'KA 22 AB 1234', make: 'Tata', model: 'Ace Gold', variant: 'Petrol CX',
    kind: VehicleKind.LCV, fuelType: FuelType.PETROL, year: 2022, capacityTonnes: 0.9, mileageKmpl: 17,
    status: VehicleStatus.ACTIVE, ownership: VehicleOwnership.FINANCED, driverCode: 'GR-D-101',
    finance: {
      lender: 'Shriram Finance', account: 'SF-VL-88231', loanAmount: 520000, downPayment: 120000,
      startedDaysAgo: 540, tenureMonths: 48, ratePct: 11.25, paidInstallments: 18, status: FinanceStatus.ACTIVE,
    },
  },
  {
    registration: 'KA 22 CD 5678', make: 'Tata', model: '407 Gold SFC',
    kind: VehicleKind.TRUCK, fuelType: FuelType.DIESEL, year: 2021, capacityTonnes: 2.5, mileageKmpl: 9,
    status: VehicleStatus.ACTIVE, ownership: VehicleOwnership.OWNED, driverCode: 'GR-D-102',
  },
  {
    registration: 'KA 22 EF 9012', make: 'Mahindra', model: 'Bolero Pik-Up',
    kind: VehicleKind.PICKUP, fuelType: FuelType.DIESEL, year: 2020, capacityTonnes: 1.7, mileageKmpl: 13,
    status: VehicleStatus.MAINTENANCE, ownership: VehicleOwnership.OWNED,
  },
  {
    registration: 'KA 22 GH 3456', make: 'Eicher', model: 'Pro 2059',
    kind: VehicleKind.TRUCK, fuelType: FuelType.DIESEL, year: 2023, capacityTonnes: 3.5, mileageKmpl: 8,
    status: VehicleStatus.ACTIVE, ownership: VehicleOwnership.FINANCED, driverCode: 'GR-D-104',
    finance: {
      lender: 'HDFC Bank', account: 'HDFC-CV-44190', loanAmount: 1450000, downPayment: 350000,
      startedDaysAgo: 300, tenureMonths: 60, ratePct: 9.75, paidInstallments: 10, status: FinanceStatus.ACTIVE,
    },
  },
  {
    registration: 'KA 22 JK 7788', make: 'Ashok Leyland', model: 'Dost+',
    kind: VehicleKind.PICKUP, fuelType: FuelType.DIESEL, year: 2022, capacityTonnes: 1.5, mileageKmpl: 14,
    status: VehicleStatus.IDLE, ownership: VehicleOwnership.FINANCED,
    finance: {
      lender: 'Cholamandalam', account: 'CHOLA-LCV-7712', loanAmount: 640000, downPayment: 160000,
      startedDaysAgo: 1500, tenureMonths: 36, ratePct: 12.5, paidInstallments: 36, status: FinanceStatus.COMPLETED,
    },
  },
];

const daysFromNow = (days: number): Date => new Date(Date.now() + days * 24 * 60 * 60 * 1000);
const dateOnly = (days: number): Date => new Date(daysFromNow(days).toISOString().slice(0, 10) + 'T00:00:00.000Z');

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo dataset must not be seeded into production.');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to seed.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    const companyName = process.env.SEED_COMPANY_NAME?.trim() || 'Gangamata Transport';
    const company = await prisma.company.findFirst({ where: { name: companyName, deletedAt: null } });
    if (!company) {
      throw new Error(`Company "${companyName}" not found. Run "npm run db:seed" first to create it.`);
    }
    console.log(`Seeding demo data into "${company.name}" (${company.id})`);

    // ── Employees and driver profiles ──────────────────────────────────────────
    const driverIdByCode = new Map<string, string>();

    for (const spec of EMPLOYEES) {
      let employee = await prisma.employee.findFirst({ where: { companyId: company.id, employeeCode: spec.code } });
      if (!employee) {
        employee = await prisma.employee.create({
          data: {
            companyId: company.id,
            employeeCode: spec.code,
            fullName: spec.name,
            phone: spec.phone,
            role: spec.role,
            designation: spec.designation ?? null,
            department: spec.department ?? null,
            preferredLanguage: spec.language,
            status: spec.status,
            joiningDate: dateOnly(-spec.joinedDaysAgo),
            baseSalary: spec.baseSalary,
            pfApplicable: spec.pf.applicable,
            uan: spec.pf.uan ?? null,
            pfMemberId: spec.pf.memberId ?? null,
          },
        });
        console.log(`  employee ${spec.code} ${spec.name}`);
      }

      if (spec.driver) {
        const existingDriver = await prisma.driver.findFirst({ where: { companyId: company.id, employeeId: employee.id } });
        const driver =
          existingDriver ??
          (await prisma.driver.create({
            data: {
              companyId: company.id,
              employeeId: employee.id,
              driverCode: spec.driver.code,
              status: spec.driver.status,
              licenceNumber: spec.driver.licence,
              licenceExpiryDate: dateOnly(spec.driver.licenceExpiryInDays),
              homeTown: spec.driver.homeTown,
              emergencyContactName: spec.driver.emergency.name,
              emergencyContactPhone: spec.driver.emergency.phone,
              locationSharingEnabled: spec.driver.status === DriverStatus.ACTIVE,
            },
          }));
        if (!existingDriver) console.log(`  driver   ${spec.driver.code} → ${spec.name}`);
        driverIdByCode.set(spec.driver.code, driver.id);
      }
    }

    // ── Vehicles, assignments and financing ────────────────────────────────────
    for (const spec of VEHICLES) {
      let vehicle = await prisma.vehicle.findFirst({
        where: { companyId: company.id, registrationNumber: spec.registration },
        include: { financing: true },
      });

      if (!vehicle) {
        vehicle = await prisma.vehicle.create({
          data: {
            companyId: company.id,
            registrationNumber: spec.registration,
            make: spec.make,
            model: spec.model,
            variant: spec.variant ?? null,
            kind: spec.kind,
            fuelType: spec.fuelType,
            manufactureYear: spec.year,
            capacityTonnes: spec.capacityTonnes,
            mileageKmpl: spec.mileageKmpl,
            status: spec.status,
            ownership: spec.ownership,
          },
          include: { financing: true },
        });
        console.log(`  vehicle  ${spec.registration} (${spec.ownership})`);
      }

      const driverId = spec.driverCode ? driverIdByCode.get(spec.driverCode) : undefined;
      if (driverId && !vehicle.currentAssignmentId) {
        const assignment = await prisma.vehicleAssignment.create({
          data: {
            companyId: company.id,
            vehicleId: vehicle.id,
            driverId,
            startedAt: daysFromNow(-120),
            notes: 'Seeded demo assignment.',
          },
        });
        await prisma.vehicle.update({ where: { id: vehicle.id }, data: { currentAssignmentId: assignment.id } });
        await prisma.driver.update({ where: { id: driverId }, data: { currentAssignmentId: assignment.id } });
        console.log(`  assign   ${spec.registration} → ${spec.driverCode}`);
      }

      if (spec.finance && !vehicle.financing) {
        const principal = spec.finance.loanAmount;
        const { emiAmount } = calculateEmi({
          principal,
          annualRatePct: spec.finance.ratePct,
          tenureMonths: spec.finance.tenureMonths,
        });
        const outstanding = outstandingPrincipal(
          { principal, annualRatePct: spec.finance.ratePct, tenureMonths: spec.finance.tenureMonths },
          spec.finance.paidInstallments,
        );

        await prisma.vehicleFinancing.create({
          data: {
            vehicleId: vehicle.id,
            status: spec.finance.status,
            lenderName: spec.finance.lender,
            loanAccountNumber: spec.finance.account,
            loanAmount: principal,
            downPayment: spec.finance.downPayment,
            financeStartDate: dateOnly(-spec.finance.startedDaysAgo),
            tenureMonths: spec.finance.tenureMonths,
            totalInstallments: spec.finance.tenureMonths,
            paidInstallments: spec.finance.paidInstallments,
            interestRatePct: spec.finance.ratePct,
            emiAmount,
            outstandingAmount: outstanding,
            nextDueDate: spec.finance.status === FinanceStatus.ACTIVE ? dateOnly(12) : null,
          },
        });
        console.log(`  finance  ${spec.registration} ${spec.finance.lender} EMI ₹${emiAmount.toLocaleString('en-IN')}`);
      }
    }

    // A historical assignment, so the assignment history screen has something to show:
    // Ganesh Jadhav drove KA 22 CD 5678 before Suresh Patil took it over.
    const formerDriverId = driverIdByCode.get('GR-D-105');
    const handedOver = await prisma.vehicle.findFirst({
      where: { companyId: company.id, registrationNumber: 'KA 22 CD 5678' },
      select: { id: true },
    });
    if (formerDriverId && handedOver) {
      const alreadyThere = await prisma.vehicleAssignment.findFirst({
        where: { companyId: company.id, vehicleId: handedOver.id, driverId: formerDriverId },
        select: { id: true },
      });
      if (!alreadyThere) {
        await prisma.vehicleAssignment.create({
          data: {
            companyId: company.id,
            vehicleId: handedOver.id,
            driverId: formerDriverId,
            startedAt: daysFromNow(-420),
            endedAt: daysFromNow(-130),
            endReason: 'vehicle_reassigned',
            notes: 'Seeded historical assignment.',
          },
        });
        console.log('  history  KA 22 CD 5678 previously driven by GR-D-105');
      }
    }

    console.log('Demo data ready.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
