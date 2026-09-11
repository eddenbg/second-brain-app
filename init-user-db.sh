#!/bin/bash
# Initialize database user and grants for Second Brain app
# This script runs automatically as part of Docker Postgres initialization

set -e

# Use POSTGRES_INITDB_ARGS to pass superuser password during container startup
# Usage: docker run -e POSTGRES_PASSWORD=<postgres-password> -e APP_DB_USER=second_brain_app_user -e APP_DB_PASSWORD=<app-password> postgres

APP_DB_USER="${APP_DB_USER:-second_brain_app_user}"
APP_DB_NAME="${APP_DB_NAME:-second_brain_app}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- Create application database (if not already created by schema.sql)
  CREATE DATABASE $APP_DB_NAME;

  -- Create application user (if not exists)
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_user WHERE usename = '$APP_DB_USER') THEN
      CREATE USER $APP_DB_USER WITH PASSWORD '${APP_DB_PASSWORD:-changeme}';
    END IF;
  END
  \$\$;

  -- Connect to the app database and grant permissions
EOSQL

# Connect to the app database and set permissions
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$APP_DB_NAME" <<-EOSQL
  -- Grant schema permissions
  GRANT USAGE ON SCHEMA public TO $APP_DB_USER;
  GRANT CREATE ON SCHEMA public TO $APP_DB_USER;

  -- Grant table permissions
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $APP_DB_USER;

  -- Grant sequence permissions (for auto-increment columns)
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $APP_DB_USER;

  -- Set default privileges for future tables
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $APP_DB_USER;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO $APP_DB_USER;

  -- Connect permission
  GRANT CONNECT ON DATABASE $APP_DB_NAME TO $APP_DB_USER;
EOSQL

echo "✓ Database $APP_DB_NAME created"
echo "✓ User $APP_DB_USER created and granted permissions"
