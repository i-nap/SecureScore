-- init-banking.sql
-- Runs as the superuser inside postgres-banking container.
-- POSTGRES_USER=banking_svc and POSTGRES_DB=securescore_banking already exist.
-- This script creates the audit user, audit database, and sets permissions.

-- Create audit service role (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'audit_svc') THEN
    CREATE ROLE audit_svc WITH LOGIN PASSWORD 'changeme_audit';
  END IF;
END
$$;

-- Create audit database (idempotent)
SELECT 'CREATE DATABASE securescore_audit OWNER audit_svc'
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname = 'securescore_audit')
\gexec

-- Grant banking_svc access to audit db (needed for the banking service to write audit records)
GRANT CONNECT ON DATABASE securescore_audit TO banking_svc;
