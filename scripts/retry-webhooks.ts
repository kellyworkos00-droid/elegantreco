/**
 * Kelly OS - Retry Failed Webhooks Script
 * Run this periodically (cron job) to retry failed webhook processing
 */

import { PrismaClient } from '@prisma/client';
import { retryFailedWebhooks } from '../lib/payments/security';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking for failed webhooks...');
  
  const results = await retryFailedWebhooks(3);
  
  console.log(`✅ Retry completed:`);
  console.log(`   Success: ${results.success}`);
  console.log(`   Failed: ${results.failed}`);
  
  // Display remaining failed webhooks
  const remaining = await prisma.webhookEvent.count({
    where: {
      processed: false,
      retryCount: {
        lt: 3,
      },
    },
  });
  
  console.log(`\nRemaining failed webhooks: ${remaining}`);
}

main()
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
