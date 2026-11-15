FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node . .
RUN mkdir -p /app/data && chown node:node /app/data
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
USER node
VOLUME ["/app/data"]
CMD ["npm", "start"]
