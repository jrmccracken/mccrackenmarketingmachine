FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV PORT=3001 MMM_DB_PATH=/data/mmm.db
VOLUME /data
EXPOSE 3001
CMD ["npm", "start"]
