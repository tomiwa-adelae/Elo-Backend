/**
 * Creates (or promotes) the store owner's admin account.
 *
 *   pnpm create-admin owner@store.com "a-strong-password" "First" "Last"
 *
 * With no arguments it reads ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD from .env,
 * which keeps the password out of shell history.
 */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { createPrisma } from './db';

const [argEmail, argPassword, firstName, lastName] = process.argv.slice(2);
const email = (argEmail ?? process.env.ADMIN_SEED_EMAIL ?? '').trim().toLowerCase();
const password = argPassword ?? process.env.ADMIN_SEED_PASSWORD ?? '';

if (!email || !password) {
  console.error('Usage: pnpm create-admin <email> <password> [first] [last]');
  console.error('   or set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD in .env');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Use a password of at least 8 characters.');
  process.exit(1);
}

const prisma = createPrisma();

async function main() {
  const hash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN', password: hash, emailVerified: true },
    create: {
      email,
      password: hash,
      role: 'ADMIN',
      emailVerified: true,
      firstName: firstName ?? 'ELO',
      lastName: lastName ?? 'Owner',
    },
  });

  await prisma.admin.upsert({
    where: { userId: user.id },
    update: { position: 'SUPER_ADMIN' },
    create: { userId: user.id, position: 'SUPER_ADMIN' },
  });

  console.log(`Admin ready: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
