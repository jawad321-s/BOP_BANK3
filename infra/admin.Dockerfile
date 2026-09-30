FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/
RUN pnpm install --frozen-lockfile --filter @bitaqati/admin... --filter @bitaqati/shared
COPY packages/shared packages/shared
COPY apps/admin apps/admin
ENV NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @bitaqati/shared build && pnpm --filter @bitaqati/admin build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN useradd -r -u 10001 app
COPY --from=build /app/apps/admin/.next/standalone ./
COPY --from=build /app/apps/admin/.next/static ./apps/admin/.next/static
USER app
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
