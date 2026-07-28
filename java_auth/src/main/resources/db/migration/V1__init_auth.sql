-- ============================================================
-- V1: Auth schema — users, refresh_tokens, login_events
-- Identical to Go migration 000001_init_auth.up.sql
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username            VARCHAR(50)  NOT NULL,
    email               VARCHAR(255) NOT NULL,
    password_hash       TEXT         NOT NULL,
    role                VARCHAR(30)  NOT NULL
        CONSTRAINT users_role_check
            CHECK (role IN (
                'customer', 'teller', 'branch_manager',
                'credit_officer', 'auditor', 'admin', 'system'
            )),
    branch_code         VARCHAR(20)  NOT NULL DEFAULT '',
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    is_locked           BOOLEAN      NOT NULL DEFAULT FALSE,
    failed_attempts     INTEGER      NOT NULL DEFAULT 0
        CONSTRAINT users_failed_attempts_non_negative CHECK (failed_attempts >= 0),
    locked_at           TIMESTAMPTZ,
    last_login_at       TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT users_username_unique UNIQUE (username),
    CONSTRAINT users_email_unique    UNIQUE (email)
);

CREATE TRIGGER set_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_users_username     ON users (username);
CREATE INDEX idx_users_email        ON users (email);
CREATE INDEX idx_users_role         ON users (role);
CREATE INDEX idx_users_branch_code  ON users (branch_code);
CREATE INDEX idx_users_is_locked    ON users (is_locked) WHERE is_locked = TRUE;

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash     VARCHAR(64) NOT NULL,
    family         UUID        NOT NULL,
    issued_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ NOT NULL,
    revoked        BOOLEAN     NOT NULL DEFAULT FALSE,
    revoked_at     TIMESTAMPTZ,
    revoked_reason VARCHAR(50),
    ip_address     VARCHAR(45) NOT NULL DEFAULT '',
    user_agent     TEXT        NOT NULL DEFAULT '',

    CONSTRAINT refresh_tokens_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX idx_refresh_tokens_user_id    ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens (token_hash);
CREATE INDEX idx_refresh_tokens_family     ON refresh_tokens (family);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens (expires_at);
CREATE INDEX idx_refresh_tokens_revoked    ON refresh_tokens (revoked) WHERE revoked = FALSE;

CREATE TABLE IF NOT EXISTS login_events (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        REFERENCES users(id) ON DELETE SET NULL,
    username       VARCHAR(50) NOT NULL,
    success        BOOLEAN     NOT NULL,
    failure_reason VARCHAR(100),
    ip_address     VARCHAR(45) NOT NULL DEFAULT '',
    user_agent     TEXT        NOT NULL DEFAULT '',
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_login_events_user_id     ON login_events (user_id);
CREATE INDEX idx_login_events_occurred_at ON login_events (occurred_at DESC);
CREATE INDEX idx_login_events_ip_address  ON login_events (ip_address);
CREATE INDEX idx_login_events_success     ON login_events (success);
