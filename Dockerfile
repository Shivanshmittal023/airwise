# Small, non-root production image (no npm dependencies to install).
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
