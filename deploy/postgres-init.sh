#!/bin/bash
# Runs once, when the postgres container starts with an empty data folder (official image's
# /docker-entrypoint-initdb.d). Creates the app's database owner "haushaltsbuch":
#   - not a superuser, so the app cannot touch anything outside its own database;
#   - CREATEROLE, because the migrations create the role app_user for row-level security.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v pw="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE haushaltsbuch LOGIN NOSUPERUSER CREATEROLE PASSWORD :'pw';
CREATE DATABASE haushaltsbuch OWNER haushaltsbuch;
SQL
