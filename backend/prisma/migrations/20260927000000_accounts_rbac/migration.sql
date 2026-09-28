-- Production correction: login account lifecycle and session revocation.
--
-- Account status is separate from employment status. INVITED marks an account whose temporary
-- password has not been replaced yet; SUSPENDED and DISABLED block sign-in. New enum values are
-- only added here, never used, because PostgreSQL cannot use an enum value in the transaction
-- that adds it.

-- AlterEnum
ALTER TYPE "user_status" ADD VALUE 'INVITED';
ALTER TYPE "user_status" ADD VALUE 'SUSPENDED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "password_changed_at" TIMESTAMPTZ(3),
ADD COLUMN     "session_version" INTEGER NOT NULL DEFAULT 0;

-- Every login needs something to sign in with.
ALTER TABLE "users" ADD CONSTRAINT "users_identifier_present" CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);
ALTER TABLE "users" ADD CONSTRAINT "users_session_version_non_negative" CHECK ("session_version" >= 0);

-- A login may only be linked to an employee of its own company.
CREATE OR REPLACE FUNCTION "assert_user_employee_same_company"() RETURNS trigger AS $$
BEGIN
  IF NEW."employee_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "employees" e WHERE e."id" = NEW."employee_id" AND e."company_id" = NEW."company_id"
  ) THEN
    RAISE EXCEPTION 'employee % belongs to another company', NEW."employee_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_employee_same_company"
  BEFORE INSERT OR UPDATE OF "employee_id", "company_id" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "assert_user_employee_same_company"();
