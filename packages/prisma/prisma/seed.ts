import 'dotenv/config';
import { PrismaClient } from '../src/generated/client/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// MODEL-SERVE-040. maxModelsPerWorkspace / maxMembersPerWorkspace: null = no limit.
const PLANS = [
  {
    name: 'FREE',
    price: 0,
    maxWorkspaces: 1,
    maxModelsPerWorkspace: 5,
    maxMembersPerWorkspace: 3,
    durationMonths: 1,
  },
  {
    name: 'STANDARD',
    price: 8,
    maxWorkspaces: 3,
    maxModelsPerWorkspace: 30,
    maxMembersPerWorkspace: 10,
    durationMonths: 1,
  },
  {
    name: 'PRO',
    price: 19,
    maxWorkspaces: 10,
    maxModelsPerWorkspace: 100,
    maxMembersPerWorkspace: 20,
    durationMonths: 1,
  },
  {
    name: 'ENTERPRISE',
    price: null,
    maxWorkspaces: 999,
    maxModelsPerWorkspace: null,
    maxMembersPerWorkspace: null,
    durationMonths: 1,
  },
];

async function main() {
  console.log('Seeding plans…');
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { name: plan.name },
      update: {
        price: plan.price,
        maxWorkspaces: plan.maxWorkspaces,
        maxModelsPerWorkspace: plan.maxModelsPerWorkspace,
        maxMembersPerWorkspace: plan.maxMembersPerWorkspace,
      },
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
