# NuvaMail: una sola imagen con la API NestJS y la web Angular compilada.
# ---------- web ----------
FROM node:22-slim AS web
WORKDIR /repo
COPY libs ./libs
COPY apps/web/package*.json ./apps/web/
RUN cd apps/web && npm ci --legacy-peer-deps
COPY apps/web ./apps/web
RUN cd apps/web && npx ng build --configuration production

# ---------- api ----------
FROM node:22-slim AS api
WORKDIR /repo
COPY libs ./libs
COPY apps/api/package*.json ./apps/api/
RUN cd apps/api && npm ci --legacy-peer-deps
COPY apps/api ./apps/api
RUN cd apps/api && npm run build && npm prune --omit=dev --legacy-peer-deps

# ---------- ejecución ----------
FROM node:22-slim
ENV NODE_ENV=production PORT=3000 WEB_DIST=/app/public
WORKDIR /app
COPY --from=api /repo/apps/api/dist ./dist
COPY --from=api /repo/apps/api/node_modules ./node_modules
COPY --from=api /repo/apps/api/package.json ./package.json
COPY --from=api /repo/apps/api/migraciones ./migraciones
COPY --from=api /repo/apps/api/scripts ./scripts
COPY --from=web /repo/apps/web/dist/web/browser ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
