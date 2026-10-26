FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# Headless Chromium + Thai fonts render the contract PDFs.
# Python runs rembg (MIT), which cuts the background off car photos; Debian rather
# than Alpine because rembg's onnxruntime ships no musl builds.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-noto-core fonts-thai-tlwg python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# rembg in its own venv; the model is downloaded now so the server never fetches it at
# runtime. Each photo starts one short-lived Python process (src/shared/remove-bg.js).
ENV U2NET_HOME=/opt/rembg/models REMBG_PYTHON=/opt/rembg/bin/python
RUN python3 -m venv /opt/rembg \
 && /opt/rembg/bin/pip install --no-cache-dir "rembg[cpu]==2.0.86" \
 && /opt/rembg/bin/python -c "from rembg import new_session; new_session('isnet-general-use')" \
 && chmod -R a+rX /opt/rembg

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
# Local file storage (used when R2 is not configured); volumes mounted here keep this ownership.
RUN mkdir -p uploads storage && chown node:node uploads storage

USER node
EXPOSE 5000

# Migrations are advisory-locked, so running them on every start is safe.
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]
