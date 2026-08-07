FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.mjs ./

USER node
CMD ["node", "server.mjs"]
