# Friend Arcade container image (used by Railway, Fly.io, Render or any Docker host).
FROM node:22-slim

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/friend-arcade.db \
    TRUST_PROXY=1

RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
