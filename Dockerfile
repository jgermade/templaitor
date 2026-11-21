# templaitor hosted service (templaitor serve): users, organizations, editor per org and send API.
# PDFs are rendered with WeasyPrint (PDF/UA-1) inside a sandbox.

# ── build: editor bundle ──
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

# ── runtime ──
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    TEMPLAITOR_DATA_DIR=/data \
    TEMPLAITOR_PYTHON=/opt/weasyprint/bin/python \
    TEMPLAITOR_WEASYPRINT=/opt/weasyprint/bin/weasyprint \
    PORT=3000
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 fonts-dejavu-core fonts-liberation \
 && python3 -m venv /opt/weasyprint && /opt/weasyprint/bin/pip install --no-cache-dir 'weasyprint>=62' \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY bin ./bin
COPY src ./src
COPY assets ./assets
COPY examples/demo ./examples/demo
COPY --from=build /app/dist/editor ./dist/editor
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "bin/templaitor.js", "serve"]
