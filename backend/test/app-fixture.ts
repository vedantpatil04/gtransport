import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { AppConfigService } from '../src/config/app-config.service';
import { PasswordHasher } from '../src/modules/auth/password-hasher';

export const TEST_PASSWORD = 'e2e-password-1234';

/**
 * A provider to stand in for a real external service. Only the two external boundaries — the AI
 * provider and the email provider — are ever replaced this way, and only from a test file.
 */
export interface ProviderOverride {
  token: symbol | string;
  value: unknown;
}

export async function createTestApp(overrides: ProviderOverride[] = []): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  for (const { token, value } of overrides) {
    builder = builder.overrideProvider(token).useValue(value);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app, app.get(AppConfigService));
  await app.init();
  return app;
}

export function rawPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
}

/**
 * Seeds an isolated company per run. Identifiers are unique, so repeated runs never collide
 * and no test depends on data left behind by another.
 */
export async function seedCompany(prisma: PrismaClient) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
  const hasher = new PasswordHasher();
  const passwordHash = await hasher.hash(TEST_PASSWORD);

  const company = await prisma.company.create({ data: { name: `E2E Transport ${stamp}` } });

  const adminEmployee = await prisma.employee.create({
    data: { companyId: company.id, employeeCode: `ADM-${stamp}`, fullName: 'Office Admin' },
  });
  const admin = await prisma.user.create({
    data: { companyId: company.id, employeeId: adminEmployee.id, email: `admin-${stamp}@e2e.test`, role: UserRole.ADMIN, passwordHash },
  });

  const driverEmployee = await prisma.employee.create({
    data: {
      companyId: company.id,
      employeeCode: `DRV-${stamp}`,
      fullName: 'Ramesh Kumar',
      baseSalary: '21000.00',
      pfApplicable: true,
      uan: '100200300400',
    },
  });
  const driver = await prisma.driver.create({
    data: { companyId: company.id, employeeId: driverEmployee.id, driverCode: `GR-D-${stamp.slice(-6)}`, licenceNumber: `KA05-${stamp}` },
  });
  const driverUser = await prisma.user.create({
    data: { companyId: company.id, employeeId: driverEmployee.id, phone: `+9198${stamp.slice(-8)}`, role: UserRole.DRIVER, passwordHash },
  });

  const vehicle = await prisma.vehicle.create({
    data: {
      companyId: company.id,
      registrationNumber: `KA 22 AB ${stamp.slice(-4)}`,
      kind: 'TRUCK',
      fuelType: 'DIESEL',
    },
  });

  // The vehicle→driver link lives in the assignment history, with both sides pointing at it.
  const assignment = await prisma.vehicleAssignment.create({
    data: { companyId: company.id, vehicleId: vehicle.id, driverId: driver.id, startedAt: new Date() },
  });
  await prisma.vehicle.update({ where: { id: vehicle.id }, data: { currentAssignmentId: assignment.id } });
  await prisma.driver.update({ where: { id: driver.id }, data: { currentAssignmentId: assignment.id } });

  // A second driver with their own document, to prove scoping actually excludes it.
  const otherEmployee = await prisma.employee.create({
    data: { companyId: company.id, employeeCode: `OTH-${stamp}`, fullName: 'Other Driver' },
  });
  const otherDriver = await prisma.driver.create({
    data: { companyId: company.id, employeeId: otherEmployee.id, driverCode: `GR-D-O${stamp.slice(-5)}` },
  });

  const ownLicence = await prisma.document.create({
    data: { companyId: company.id, type: 'DRIVING_LICENCE', ownerType: 'EMPLOYEE', employeeId: driverEmployee.id, documentNumber: 'DL-OWN' },
  });
  const vehicleInsurance = await prisma.document.create({
    data: { companyId: company.id, type: 'INSURANCE', ownerType: 'VEHICLE', vehicleId: vehicle.id, documentNumber: 'INS-OWN' },
  });
  const otherLicence = await prisma.document.create({
    data: { companyId: company.id, type: 'DRIVING_LICENCE', ownerType: 'EMPLOYEE', employeeId: otherEmployee.id, documentNumber: 'DL-OTHER' },
  });

  return {
    company,
    admin: { id: admin.id, identifier: admin.email as string },
    driver: { id: driver.id, userId: driverUser.id, identifier: driverUser.phone as string, employeeId: driverEmployee.id },
    otherDriver,
    vehicle,
    documents: { ownLicence, vehicleInsurance, otherLicence },
  };
}
