-- 0002_disputed_and_uncaptured_statuses.sql
-- Adds the two remaining Dashboard statuses:
--   disputed   - the customer disputed a settled payment (chargeback)
--   uncaptured - authorised but not yet captured
-- Neither carries a failure code or a refund date, so the existing
-- status-dependent CHECKs already hold for them.

ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('succeeded', 'pending', 'failed', 'refunded', 'disputed', 'uncaptured'));
