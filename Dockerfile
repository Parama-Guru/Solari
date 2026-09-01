FROM node:24-alpine

WORKDIR /app

# No runtime dependencies exist, so this installs nothing and stays tiny.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Node 24 runs the TypeScript directly, so there is no build output to copy.
CMD ["node", "src/server/main.ts"]
