# One image for the backend and every agent process. Layout mirrors the repo because
# backend/src/config.ts and agent/src/chain.ts resolve ROOT as ../.. and backend/src/demo.ts
# imports ../../agent/*. Explicit COPY paths only: no .env or *.keys.json can reach the image.
FROM node:22-slim
WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
COPY agent/package.json agent/package-lock.json agent/
RUN cd backend && npm ci --no-audit --no-fund && cd ../agent && npm ci --no-audit --no-fund && npm cache clean --force
COPY deployments deployments
COPY backend/src backend/src
COPY agent/src agent/src
COPY agent/loop.ts agent/liquidator.ts agent/keeper.ts agent/demo-setup.ts agent/attempt.ts agent/mandates.json agent/
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production
WORKDIR /app/backend
CMD ["node_modules/.bin/tsx", "src/server.ts"]
