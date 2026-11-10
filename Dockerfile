ARG NODE_IMAGE=node:22.22.2-bookworm-slim
# Compile platform-independent JS/assets on the builder's native architecture.
# The final stage still uses the requested target platform (e.g. linux/amd64).
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY ZohoWeb/package.json ./ZohoWeb/package.json
COPY ZohoService/package.json ./ZohoService/package.json
RUN npm ci --no-audit --no-fund --registry=https://registry.npmjs.org

COPY ZohoWeb/index.html ZohoWeb/tsconfig.json ZohoWeb/vite.config.ts ./ZohoWeb/
COPY ZohoWeb/src ./ZohoWeb/src
COPY ZohoWeb/public ./ZohoWeb/public
COPY ZohoService/tsconfig.json ZohoService/tsconfig.build.json ./ZohoService/
COPY ZohoService/src ./ZohoService/src
RUN npm run build

FROM ${NODE_IMAGE} AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    WEB_ROOT=/app/web \
    DATA_DIR=/app/data \
    DOTENV_CONFIG_PATH=/app/config/zohome.env

COPY package.json package-lock.json ./
COPY ZohoWeb/package.json ./ZohoWeb/package.json
COPY ZohoService/package.json ./ZohoService/package.json
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org \
    && npm cache clean --force \
    && mkdir -p /app/config /app/data \
    && chown node:node /app/config /app/data

COPY --from=build --chown=node:node /app/ZohoService/dist ./ZohoService/dist
COPY --from=build --chown=node:node /app/ZohoWeb/dist ./web

USER node
EXPOSE 3001
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/api/status',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "ZohoService/dist/main.js"]
