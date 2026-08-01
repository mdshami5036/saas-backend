const { PrismaClient } = require('@prisma/client');

let prisma;

try {
  prisma = new PrismaClient();
} catch (error) {
  console.warn('PrismaClient initialization warning:', error.message);
}

module.exports = prisma;
