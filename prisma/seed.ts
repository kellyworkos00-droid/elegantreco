/**
 * Kelly OS - Database Seed Script
 * Creates sample data for testing
 */

import { PrismaClient, CustomerStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create sample customers
  const customers = await Promise.all([
    prisma.customer.create({
      data: {
        customerCode: 'CUST001',
        name: 'John Kamau',
        phone: '0712345678',
        email: 'john@example.com',
        balance: 0,
        creditLimit: 100000,
        branch: 'NAIROBI',
        category: 'RETAIL',
        status: CustomerStatus.ACTIVE,
      },
    }),
    prisma.customer.create({
      data: {
        customerCode: 'CUST002',
        name: 'Mary Wanjiku',
        phone: '0723456789',
        email: 'mary@example.com',
        balance: 0,
        creditLimit: 200000,
        branch: 'MOMBASA',
        category: 'WHOLESALE',
        status: CustomerStatus.ACTIVE,
      },
    }),
    prisma.customer.create({
      data: {
        customerCode: 'CUST003',
        name: 'ABC Construction Ltd',
        phone: '0734567890',
        email: 'info@abcconstruction.com',
        businessName: 'ABC Construction Limited',
        balance: 0,
        creditLimit: 500000,
        branch: 'NAIROBI',
        category: 'CORPORATE',
        status: CustomerStatus.ACTIVE,
      },
    }),
  ]);

  console.log(`✅ Created ${customers.length} customers`);

  // Create system config
  await prisma.systemConfig.upsert({
    where: { key: 'vat_rate' },
    update: { value: 0.16 },
    create: {
      key: 'vat_rate',
      value: 0.16,
      description: 'VAT rate for Kenya (16%)',
      updatedBy: 'SYSTEM',
    },
  });

  console.log('✅ System configuration created');
  console.log('\n🎉 Database seeded successfully!');
}

main()
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
