# syntax=docker/dockerfile:1
#
# Build context must be the monorepo root (parent of `nextjs-firebase`), e.g.:
#   docker build -f nextjs-firebase/Dockerfile .
# Same image as repo root [Dockerfile](../Dockerfile) — keep both in sync.

FROM node:23-alpine AS builder
ARG GCP_PROJECT_ID
ENV GOOGLE_CLOUD_PROJECT=${GCP_PROJECT_ID}
ENV GCLOUD_PROJECT=${GCP_PROJECT_ID}

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages
COPY mobile/package.json ./mobile/
COPY nextjs-firebase ./nextjs-firebase

RUN npm ci

WORKDIR /app/nextjs-firebase
ENV NEXT_TELEMETRY_DISABLED=1
RUN touch /tmp/koochly-offline-sitemap-build && npm run build && rm -f /tmp/koochly-offline-sitemap-build

FROM node:23-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/nextjs-firebase/.next/standalone ./
COPY --from=builder /app/nextjs-firebase/.next/static ./nextjs-firebase/.next/static
COPY --from=builder /app/nextjs-firebase/public ./nextjs-firebase/public

EXPOSE 8080
CMD ["node", "nextjs-firebase/server.js"]
