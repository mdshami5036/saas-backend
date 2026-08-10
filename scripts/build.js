const { execSync } = require('child_process');

// Fallback placeholder DATABASE_URL for build-time Prisma Client generation if env variable is missing
if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
  console.log('[Build] Using placeholder DATABASE_URL for Prisma Client generation...');
  process.env.DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder_db';
}

console.log('[Build] Running Prisma Generate...');
try {
  execSync('npx prisma generate', { stdio: 'inherit', env: process.env });
  console.log('[Build] Prisma Client successfully generated!');
} catch (error) {
  console.error('[Build Error]: Failed to generate Prisma Client', error.message);
  process.exit(1);
}
