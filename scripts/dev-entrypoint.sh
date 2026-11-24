#!/bin/sh
# Development container entrypoint: migrate, optionally seed, then run the API
# in watch mode. The source tree is bind-mounted, so edits hot-reload.
set -eu

npm run db:migrate:dev
if [ "${SEED_ON_START:-false}" = "true" ]; then
  npm run db:seed
fi
exec npm run start:dev
