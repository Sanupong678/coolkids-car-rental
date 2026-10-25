FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# Headless Chromium + Thai fonts render the contract PDFs.
RUN apk add --no-cache chromium font-noto font-noto-thai

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
# Local file storage (used when R2 is not configured); volumes mounted here keep this ownership.
RUN mkdir -p uploads storage && chown node:node uploads storage

USER node
EXPOSE 5000

# Migrations are advisory-locked, so running them on every start is safe.
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]
