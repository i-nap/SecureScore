-- SecureScore Compliance Engine — Initial Schema
-- NRB-compliant compliance decision and STR tables

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE compliance_decisions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  VARCHAR(36)     NOT NULL,
    customer_id     VARCHAR(36),
    entity_type     VARCHAR(20)     NOT NULL DEFAULT 'transaction',
    decision        VARCHAR(20)     NOT NULL,
    regulatory_code VARCHAR(20),
    decision_reason VARCHAR(500),
    fraud_score     DECIMAL(5, 4),
    anomaly_score   DECIMAL(5, 4),
    risk_level      VARCHAR(20),
    model_version   VARCHAR(50),
    requires_str    BOOLEAN         NOT NULL DEFAULT FALSE,
    amount          DECIMAL(20, 4),
    currency        VARCHAR(3),
    channel         VARCHAR(30),
    correlation_id  VARCHAR(36),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cd_transaction_id ON compliance_decisions (transaction_id);
CREATE INDEX idx_cd_customer_id    ON compliance_decisions (customer_id);
CREATE INDEX idx_cd_decision       ON compliance_decisions (decision);
CREATE INDEX idx_cd_created_at     ON compliance_decisions (created_at DESC);
CREATE INDEX idx_cd_requires_str   ON compliance_decisions (requires_str) WHERE requires_str = TRUE;

CREATE TABLE suspicious_transaction_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  VARCHAR(36)     NOT NULL,
    customer_id     VARCHAR(36),
    regulatory_code VARCHAR(20),
    amount          DECIMAL(20, 4),
    currency        VARCHAR(3),
    channel         VARCHAR(30),
    fraud_score     DECIMAL(5, 4),
    decision_reason VARCHAR(500),
    pdf_path        VARCHAR(500),
    submitted_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_str_transaction_id ON suspicious_transaction_reports (transaction_id);
CREATE INDEX idx_str_customer_id    ON suspicious_transaction_reports (customer_id);
CREATE INDEX idx_str_created_at     ON suspicious_transaction_reports (created_at DESC);

COMMENT ON TABLE compliance_decisions IS 'Immutable audit log of all compliance decisions made by the Drools rule engine';
COMMENT ON TABLE suspicious_transaction_reports IS 'NRB-mandated Suspicious Transaction Reports with PDF references';
