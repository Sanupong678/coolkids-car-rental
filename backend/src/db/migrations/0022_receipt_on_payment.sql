-- 0022 — Issue the receipt the moment a payment is captured, so its number
--        (RE + YYMMDD) carries the day the money came in.

CREATE OR REPLACE FUNCTION issue_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'SUCCEEDED' AND NEW.succeeded_at IS NOT NULL THEN
    INSERT INTO receipts (booking_id, payment_id, amount_minor, currency, issued_at)
    VALUES (NEW.booking_id, NEW.id, NEW.amount_minor, NEW.currency, NEW.succeeded_at)
    ON CONFLICT (payment_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payments_issue_receipt AFTER INSERT OR UPDATE OF status ON payments
  FOR EACH ROW EXECUTE FUNCTION issue_receipt();
