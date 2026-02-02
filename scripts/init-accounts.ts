/**
 * Kelly OS - Initialize Chart of Accounts Script
 * Run this once after database setup to create the accounting structure
 */

import { PrismaClient } from '@prisma/client';
import { initializeChartOfAccounts } from '../lib/payments/ledger-engine';

const prisma = new PrismaClient();

async function main() {
  console.log('Initializing chart of accounts...');
  
  await prisma.$transaction(async (tx) => {
    await initializeChartOfAccounts(tx);
  });
  
  console.log('✅ Chart of accounts initialized successfully');
  
  // Display created accounts
  const accounts = await prisma.account.findMany({
    orderBy: {
      type: 'asc',
    },
  });
  
  console.log('\nCreated accounts:');
  accounts.forEach(account => {
    console.log(`  ${account.code.padEnd(25)} - ${account.name.padEnd(30)} [${account.type}]`);
  });
}

main()
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
