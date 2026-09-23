/* eslint-disable no-console */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '@prisma/client';
import { PasswordHasher } from '../src/modules/auth/password-hasher';
import { envFilePaths } from '../src/config/env-files';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: envFilePaths(), quiet: true });

/**
 * Idempotent bootstrap seed: one company, and optionally the first SUPER_ADMIN login.
 *
 * The admin is created only when SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD are
 * set, so no default credentials can ever ship. Running it twice changes nothing.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to seed.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    const companyName = process.env.SEED_COMPANY_NAME?.trim() || 'Gangamata Transport';
    const existing = await prisma.company.findFirst({ where: { name: companyName, deletedAt: null } });
    const company = existing ?? (await prisma.company.create({ data: { name: companyName } }));
    console.log(`${existing ? 'Found' : 'Created'} company "${company.name}" (${company.id})`);

    const email = process.env.SEED_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SEED_SUPER_ADMIN_PASSWORD;

    if (!email || !password) {
      console.log('Skipping super admin: set SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD to create one.');
      return;
    }
    if (password.length < 12) throw new Error('SEED_SUPER_ADMIN_PASSWORD must be at least 12 characters.');

    const alreadyThere = await prisma.user.findFirst({ where: { companyId: company.id, email } });
    if (alreadyThere) {
      console.log(`Super admin ${email} already exists; leaving it untouched.`);
      return;
    }

    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        email,
        role: UserRole.SUPER_ADMIN,
        passwordHash: await new PasswordHasher().hash(password),
      },
      select: { id: true },
    });
    console.log(`Created SUPER_ADMIN ${email} (${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
