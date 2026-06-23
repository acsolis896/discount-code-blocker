FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# Install all deps (including devDeps) so the build step has what it needs
RUN npm ci && npm cache clean --force

COPY . .

RUN npm run build

# Prune devDeps after build to keep the image lean
RUN npm prune --omit=dev

CMD ["npm", "run", "docker-start"]
