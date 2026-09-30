# Production image for the API and worker (same image, different command).
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @bitaqati/api... --filter @bitaqati/shared
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @bitaqati/shared build && pnpm --filter @bitaqati/api build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* && useradd -r -u 10001 app
COPY --from=build /app /app
USER app
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run migrations as a separate release step: `node ../../node_modules/prisma/build/index.js migrate deploy`
CMD ["node", "dist/main.js"]
