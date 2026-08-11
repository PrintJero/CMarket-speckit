# CMarket production image.
#
# Debian slim, NOT Alpine, on purpose: @node-rs/argon2 (password hashing) is a
# native module, and its glibc prebuild is far better trodden than its musl one.
# A broken password hash at runtime is a much worse trade than ~40 MB of image.
#
# Multi-stage so the runtime carries no toolchain, no dev dependencies, and no
# source. Secrets are NEVER baked in — every CLOUDINARY_*, DATABASE_URL and
# NEXTAUTH_* value is supplied at run time (FR-100, and the constitution's
# no-secret-in-image rule).

# ---------------------------------------------------------------- deps ----
FROM node:24-slim AS deps
WORKDIR /app

# openssl is a Prisma query-engine runtime requirement, needed here so
# `prisma generate` can resolve its engines during the build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy only what changes least often, so a source edit does not reinstall.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ------------------------------------------------------------- builder ----
FROM node:24-slim AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generates the Linux query engine declared by schema.prisma's binaryTargets.
RUN npx prisma generate

# `next build` runs with NO production secrets, and that is intentional:
# requireCloudinaryConfig() throws on FIRST USE rather than at import time
# precisely so the image can be built without them (FR-106).
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# -------------------------------------------------------------- runner ----
FROM node:24-slim AS runner
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as a non-root user. node:24-slim already ships uid/gid 1000 as `node`.
RUN mkdir -p /app && chown -R node:node /app

# Next's standalone output: a minimal server plus only the modules it traced.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Prisma pieces the standalone tracer does not reliably include: the generated
# client, its Linux query engine, and the migration files.
COPY --from=builder --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=node:node /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=node:node /app/prisma ./prisma

# The migration CLI, installed into its OWN prefix.
#
# Copying node_modules/prisma across from the builder does not work: the CLI has
# transitive dependencies (@prisma/config and friends) that the standalone trace
# never saw, so it dies with MODULE_NOT_FOUND at startup. Installing it in an
# isolated directory pulls that dependency tree properly without dragging the
# app's full node_modules into the runtime layer.
#
# The version is read from package.json rather than pinned here, so a Prisma
# bump cannot silently leave the CLI and the generated client on different
# versions.
COPY --from=builder /app/package.json /tmp/app-package.json
RUN PRISMA_VERSION="$(node -p "require('/tmp/app-package.json').devDependencies.prisma.replace(/^[^0-9]/, '')")" \
  && mkdir -p /opt/prisma-cli \
  && cd /opt/prisma-cli \
  && npm init -y > /dev/null \
  && npm install --no-audit --no-fund --loglevel=error "prisma@${PRISMA_VERSION}" \
  && npm cache clean --force \
  && rm /tmp/app-package.json \
  && chown -R node:node /opt/prisma-cli

COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER node
EXPOSE 3000

# Checks the database, not just the port: a process that answers but cannot
# reach Postgres is not ready for traffic. See app/api/health/route.ts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]