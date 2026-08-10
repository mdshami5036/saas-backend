if (!process.env.DATABASE_URL || (!process.env.DATABASE_URL.startsWith('postgres://') && !process.env.DATABASE_URL.startsWith('postgresql://'))) {
  console.warn('⚠️ [Database Warning] DATABASE_URL is missing or invalid in Render Environment Variables!');
  process.env.DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder_db';
}

const { PrismaClient } = require('@prisma/client');

let prisma;
try {
  prisma = new PrismaClient();
} catch (error) {
  console.warn('[Prisma Initialization Warning]:', error.message);
}

module.exports = prisma;
