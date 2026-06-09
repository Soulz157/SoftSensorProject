import 'dotenv/config';
import { PrismaClient } from '../src/generated/client/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const PLANS = [
  { name: 'FREE', price: 0, maxWorkspaces: 1, durationMonths: 1 },
  { name: 'STANDARD', price: 8, maxWorkspaces: 3, durationMonths: 1 },
  { name: 'PRO', price: 19, maxWorkspaces: 10, durationMonths: 1 },
  { name: 'ENTERPRISE', price: null, maxWorkspaces: 999, durationMonths: 1 },
];

async function main() {
  console.log('Seeding plans…');
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { name: plan.name },
      update: { price: plan.price, maxWorkspaces: plan.maxWorkspaces },
      create: plan,
    });
    console.log(`  ✓ ${plan.name}`);
  }
  console.log('Plans seeded ✓');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
