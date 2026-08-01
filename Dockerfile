FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install
RUN npx prisma generate

COPY . .

EXPOSE 5000

ENV PORT=5000
ENV NODE_ENV=production
ENV DATABASE_URL=file:./prisma/dev.db
ENV JWT_SECRET=autoprint_super_secret_key_2024

RUN mkdir -p uploads

CMD ["sh", "-c", "npx prisma db push && node src/index.js"]
