FROM node:18-slim

RUN apt-get update && apt-get install -y openssl libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install
RUN npx prisma generate

COPY . .

RUN mkdir -p uploads

EXPOSE 5000

ENV PORT=5000
ENV NODE_ENV=production
ENV DATABASE_URL=file:./prisma/dev.db
ENV JWT_SECRET=autoprint_super_secret_key_2024

CMD ["sh", "-c", "npx prisma db push && node src/index.js"]
