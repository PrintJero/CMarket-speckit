#!/bin/sh
# CMarket container entrypoint.
#
# Applies pending Prisma migrations, then hands off to the server.
#
# `migrate deploy` ONLY — never `db push --accept-data-loss`. It applies the
# committed, versioned migration files and nothing else, which is what the
# constitution's Migrations & backups constraint requires (and FR-095 for
# 017-cloudinary-listing-media, whose migration destroys data).
#
# It is idempotent: already-applied migrations are skipped, so restarts and
# multiple replicas are safe. It is NOT safe against a missing backup — see the
# release checklist in README.md before deploying a destructive migration.
set -e

echo "[entrypoint] applying database migrations..."
# The CLI lives in its own prefix (see Dockerfile), so the schema path must be
# given explicitly — it is resolved relative to the CLI, not to /app.
if ! node /opt/prisma-cli/node_modules/prisma/build/index.js migrate deploy --schema /app/prisma/schema.prisma; then
  # Starting anyway would serve traffic against a schema the code does not
  # expect, which fails in far more confusing ways than refusing to start.
  echo "[entrypoint] migration failed — refusing to start." >&2
  exit 1
fi

echo "[entrypoint] migrations up to date; starting server."
exec "$@"