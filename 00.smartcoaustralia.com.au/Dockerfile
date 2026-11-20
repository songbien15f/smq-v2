# syntax=docker/dockerfile:1

# Production image for the Smart Solutions Australia website.
#
# The database is EXTERNAL to the container: DATABASE_URI must point at a
# reachable PostgreSQL server (the `db` service in docker-compose.yml, or a
# managed instance). Migrations are a separate deploy step so the runtime image
# does not need migration tooling at boot:
#
#   docker compose run --rm app npm run migrate
#
# Uploads are written to /app/media, which docker-compose.yml mounts from the
# host so images survive a container rebuild.

FROM node:22-alpine

WORKDIR /app

# sharp needs libc compat on musl.
RUN apk add --no-cache libc6-compat

ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies first so Docker caches this layer across source edits.
COPY package.json package-lock.json ./
RUN npm ci

# Application source (.env and media/ are excluded by .dockerignore).
COPY . .

# `next build` imports the Payload config, which reads PAYLOAD_SECRET and
# DATABASE_URI, and it prerenders robots.txt from NEXT_PUBLIC_SERVER_URL.
# Values are only used at build time here; runtime values come from the
# environment (docker-compose `env_file: .env`), so no real secret is baked in.
#
# docker-compose.yml passes the public origin as a build arg:
#   docker compose build --build-arg NEXT_PUBLIC_SERVER_URL=https://example.com
ARG NEXT_PUBLIC_SERVER_URL=http://localhost:3065
ENV NEXT_PUBLIC_SERVER_URL=$NEXT_PUBLIC_SERVER_URL

RUN PAYLOAD_SECRET=build-time-placeholder \
  DATABASE_URI=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder \
  npm run build

ENV NODE_ENV=production
ENV PORT=3065

EXPOSE 3065

CMD ["npm", "run", "start"]
