-- 0001_initial_schema.sql
-- Core relational model: currencies, customers, payment methods and payments.
-- Monetary amounts are stored as integer minor units (e.g. cents) together
-- with an ISO-4217 currency whose exponent lives in `currencies`.
-- No sensitive credentials (PAN, CVC, account numbers) are ever stored.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE currencies (
  code      char(3)  PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  exponent  smallint NOT NULL CHECK (exponent BETWEEN 0 AND 4),
  name      text     NOT NULL
);

INSERT INTO currencies (code, exponent, name) VALUES
  ('USD', 2, 'US Dollar'),
  ('EUR', 2, 'Euro'),
  ('GBP', 2, 'Pound Sterling'),
  ('CAD', 2, 'Canadian Dollar'),
  ('AUD', 2, 'Australian Dollar'),
  ('BRL', 2, 'Brazilian Real'),
  ('JPY', 0, 'Japanese Yen');

CREATE TABLE customers (
  id          text        PRIMARY KEY CHECK (id ~ '^cus_[A-Za-z0-9]{14,64}$'),
  name        text        CHECK (name IS NULL OR char_length(btrim(name)) BETWEEN 1 AND 200),
  email       text        NOT NULL CHECK (char_length(email) <= 320 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX customers_email_lower_key ON customers (lower(email));
CREATE INDEX customers_email_trgm_idx ON customers USING gin (lower(email) gin_trgm_ops);
CREATE INDEX customers_name_trgm_idx ON customers USING gin (lower(name) gin_trgm_ops);

CREATE TABLE payment_methods (
  id           text        PRIMARY KEY CHECK (id ~ '^pm_[A-Za-z0-9]{14,64}$'),
  customer_id  text        NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  type         text        NOT NULL CHECK (type IN ('card', 'ach', 'wallet')),
  brand        text        CHECK (brand IN ('visa', 'mastercard', 'amex', 'discover', 'jcb', 'unionpay', 'diners')),
  last4        char(4)     NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  wallet       text        CHECK (wallet IN ('apple_pay', 'google_pay', 'link')),
  bank_name    text        CHECK (bank_name IS NULL OR char_length(bank_name) BETWEEN 1 AND 100),
  exp_month    smallint    CHECK (exp_month BETWEEN 1 AND 12),
  exp_year     smallint    CHECK (exp_year BETWEEN 2000 AND 2100),
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Cards and wallets (which tokenise a card) carry a brand + expiry; ACH
  -- debits carry a bank name instead.
  CONSTRAINT payment_methods_brand_by_type_chk
    CHECK ((type = 'ach') = (brand IS NULL)),
  CONSTRAINT payment_methods_wallet_by_type_chk
    CHECK ((type = 'wallet') = (wallet IS NOT NULL)),
  CONSTRAINT payment_methods_bank_by_type_chk
    CHECK (type = 'ach' OR bank_name IS NULL),
  CONSTRAINT payment_methods_expiry_by_type_chk
    CHECK ((type = 'ach' AND exp_month IS NULL AND exp_year IS NULL)
        OR (type <> 'ach' AND exp_month IS NOT NULL AND exp_year IS NOT NULL)),
  -- Target of the composite foreign key on payments, guaranteeing a payment's
  -- method belongs to the same customer as the payment.
  CONSTRAINT payment_methods_id_customer_key UNIQUE (id, customer_id)
);

CREATE INDEX payment_methods_customer_id_idx ON payment_methods (customer_id);
CREATE INDEX payment_methods_last4_idx ON payment_methods (last4);

CREATE TABLE payments (
  id                 text        PRIMARY KEY CHECK (id ~ '^pi_[A-Za-z0-9]{14,64}$'),
  customer_id        text        NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  payment_method_id  text        NOT NULL,
  amount_minor       bigint      NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 99999999999),
  currency           char(3)     NOT NULL REFERENCES currencies (code),
  status             text        NOT NULL CHECK (status IN ('succeeded', 'pending', 'failed', 'refunded')),
  description        text        CHECK (description IS NULL OR char_length(description) <= 500),
  failure_code       text,
  failure_message    text,
  refunded_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payments_method_customer_fkey
    FOREIGN KEY (payment_method_id, customer_id)
    REFERENCES payment_methods (id, customer_id) ON DELETE RESTRICT,
  CONSTRAINT payments_failure_by_status_chk
    CHECK ((status = 'failed') = (failure_code IS NOT NULL)),
  CONSTRAINT payments_refund_by_status_chk
    CHECK ((status = 'refunded') = (refunded_at IS NOT NULL)),
  CONSTRAINT payments_refund_after_create_chk
    CHECK (refunded_at IS NULL OR refunded_at >= created_at),
  CONSTRAINT payments_updated_after_create_chk
    CHECK (updated_at >= created_at)
);

-- Default listing order and every sort's tie-breaker.
CREATE INDEX payments_created_at_id_idx ON payments (created_at DESC, id DESC);
CREATE INDEX payments_status_created_at_idx ON payments (status, created_at DESC);
CREATE INDEX payments_currency_amount_idx ON payments (currency, amount_minor, created_at DESC);
CREATE INDEX payments_customer_id_idx ON payments (customer_id);
CREATE INDEX payments_payment_method_id_idx ON payments (payment_method_id);
-- Substring search on payment ids.
CREATE INDEX payments_id_trgm_idx ON payments USING gin (id gin_trgm_ops);

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_set_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
