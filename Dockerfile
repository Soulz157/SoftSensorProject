FROM node:18-alpine AS base
RUN npm i -g turbo
WORKDIR /app

FROM base AS installer
COPY . .
RUN turbo prune api --docker

FROM base AS builder
WORKDIR /app
COPY --from=installer /app/out/json/ .
COPY --from=installer /app/out/package-lock.json ./package-lock.json
RUN npm install

COPY --from=installer /app/out/full/ .
COPY turbo.json turbo.json
RUN turbo run build --filter=api...

FROM base AS runner
WORKDIR /app

COPY --from=builder /app .

EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]