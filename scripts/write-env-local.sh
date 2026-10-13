#!/bin/zsh
# Writes .env.local for the local Docker SQL Server without printing the password.
# The sa password is read from the running unosof-mssql-1 container's environment.
set -euo pipefail
cd "$(dirname "$0")/.."
pw=$(docker exec unosof-mssql-1 bash -lc 'printf %s "${MSSQL_SA_PASSWORD:-$SA_PASSWORD}"')
if [[ -z "$pw" ]]; then echo "Could not read the SA password from unosof-mssql-1" >&2; exit 1; fi
sed "s|^DB_PASSWORD=.*|DB_PASSWORD=${pw//|/\\|}|" .env.example > .env.local
chmod 600 .env.local
echo "Wrote .env.local (password not shown)."
