FROM node:22-bookworm-slim AS deps

WORKDIR /app

# Native build tools are needed for modules like bcrypt on some platforms.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN chown -R node:node /app
USER node

EXPOSE 5111
CMD ["npm", "start"]
