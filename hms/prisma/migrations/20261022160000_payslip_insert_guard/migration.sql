-- Payslips may only be added to, changed in, or removed from a DRAFT payroll run. The original
-- guard covered UPDATE/DELETE and checked only the new run; this also blocks INSERT into an
-- approved run and moving a payslip out of one.
CREATE OR REPLACE FUNCTION hms_payslip_guard() RETURNS trigger AS $$
DECLARE run_status text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO run_status FROM "PayrollRun" WHERE "id" = OLD."runId";
    IF run_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Payslips of an approved payroll run are locked'; END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO run_status FROM "PayrollRun" WHERE "id" = NEW."runId";
    IF run_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Payslips of an approved payroll run are locked'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Payslip_guard" ON "Payslip";
CREATE TRIGGER "Payslip_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Payslip" FOR EACH ROW EXECUTE FUNCTION hms_payslip_guard();
