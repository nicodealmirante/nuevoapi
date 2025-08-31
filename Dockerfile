FROM node:20-alpine
WORKDIR /app

# 👉 agrega git (y ca-certificates por las dudas)
RUN apk add --no-cache git ca-certificates

COPY package*.json ./
RUN npm i --omit=dev

COPY server.js ./

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

RUN mkdir -p /app/auth
CMD ["node", "server.js"]
