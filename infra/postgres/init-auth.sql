-- init-auth.sql
-- Runs as the superuser inside postgres-auth container.
-- POSTGRES_USER=auth_svc and POSTGRES_DB=securescore_auth are already created
-- by the container entrypoint — this file only adds extra grants.
DO $$
BEGIN
  -- Ensure the user owns its own database (idempotent)
  PERFORM pg_catalog.pg_get_userbyid(datdba)
  FROM pg_catalog.pg_database
  WHERE datname = 'securescore_auth';
END
$$;

-- Grant all privileges on the database to the service user
GRANT ALL PRIVILEGES ON DATABASE securescore_auth TO auth_svc;
