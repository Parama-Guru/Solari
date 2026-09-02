FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci
COPY src ./src
RUN npm run build


FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# No runtime dependencies exist, so this installs nothing. Scripts are skipped because
# `prepare` compiles TypeScript, which is not present in this stage.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/dist ./dist
COPY samples ./samples

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so node is PID 1 and receives SIGTERM itself. A rescue owns a running VM,
# and the server needs that signal to drain rather than orphan the machine.
STOPSIGNAL SIGTERM
CMD ["node", "dist/server/main.js"]
