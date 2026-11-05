FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# A failing test stops the image from being built at all.
RUN npm run build && npm test

FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
WORKDIR /app
ENV NODE_ENV=production
# The server is bundled into one file, so the image needs no node_modules.
COPY --from=build /app/dist ./dist
USER 1000:1000
EXPOSE 8080
CMD ["node", "dist/server.cjs"]
