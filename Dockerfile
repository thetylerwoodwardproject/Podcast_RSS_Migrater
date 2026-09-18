# Debian rather than Alpine: sharp's prebuilt libvips binaries are built against
# glibc, and musl would force a source build of the whole image library.
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Manifests first, so dependency installation is cached independently of source edits.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY svelte.config.js vite.config.ts tsconfig.json eslint.config.js ./
COPY src/ src/

RUN npm run build

# Never --omit=optional: sharp resolves its native libvips through
# platform-specific optional dependencies, and dropping them produces an image
# that builds cleanly and then throws on the first image it converts.
RUN npm prune --omit=dev --no-audit --no-fund \
  && node -e "require('sharp')"


FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    MIGRATER_DATA_PATH=/data

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/build ./build

# Created before the volume is attached so a fresh named volume inherits this ownership.
RUN mkdir -p /data/jobs && chown -R node:node /data

USER node
EXPOSE 8080
VOLUME ["/data"]

# Uses node rather than curl, so the runtime image needs no extra packages.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build/index.js"]
