FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

# Install all deps (including devDeps) needed for the build
# NODE_ENV must NOT be set to production here or npm will skip devDeps
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Set production env only at runtime, after build is complete
ENV NODE_ENV=production

CMD ["npm", "run", "docker-start"]
