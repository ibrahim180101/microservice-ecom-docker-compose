FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
COPY index.html ./public/index.html
ENV NODE_ENV=production DATA_DIR=/app/data SERVICE_NAME=order-service
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node","server.js"]
