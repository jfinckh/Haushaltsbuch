# Two images from one file:
#   docker build --target app     -t haushaltsbuch .          the Next.js server
#   docker build --target migrate -t haushaltsbuch-migrate .  applies the SQL migrations once
# Built by .github/workflows/deploy.yml for linux/amd64 (Hetzner CX servers).

FROM node:22-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# All dependencies, for the build. The dev dependency @jfinckh/change-map comes from GitHub
# Packages, so npm needs a token: passed as a build secret (never stored in a layer), e.g.
#   docker build --secret id=npmrc,src=$HOME/.npmrc --target app .
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci

# Runtime dependencies only, for the migrate image (drizzle-orm and pg).
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The route modules read their settings when Next.js loads them during the build, so the build
# gets harmless placeholders. They exist only in this RUN step, not in the final image; the real
# values come from .env.production on the server at runtime.
RUN AUTH_MODE=identity \
    IDENTITY_ISSUER=https://build.invalid \
    IDENTITY_JWKS_URL=https://build.invalid/certs \
    IDENTITY_AUDIENCE=build \
    BETTER_AUTH_SECRET=build-placeholder-not-a-secret-000000 \
    BETTER_AUTH_URL=https://build.invalid \
    DATABASE_URL=postgres://build:build@127.0.0.1:1/build \
    FIELD_ENCRYPTION_KEYS=1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    BLIND_INDEX_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    npm run build

# The app: Next.js standalone output, runs as the unprivileged "node" user.
FROM base AS app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

# Migrations: the SQL files plus a small runner.
FROM base AS migrate
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY drizzle ./drizzle
COPY scripts/migrate.mjs ./scripts/migrate.mjs
USER node
CMD ["node", "scripts/migrate.mjs"]
