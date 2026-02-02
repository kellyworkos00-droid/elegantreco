/**
 * Kelly OS - Customer Statement Engine
 * Maintains running customer statement for each transaction
 */

import { Prisma, StatementType } from '@prisma/client';

interface UpdateStatementInput {
  customerId: string;
  transactionDate: Date;
  transactionType: StatementType;
  referenceType: string;
  referenceId: string;
  referenceNumber: string;
  debit?: number;
  credit?: number;
  description: string;
}

/**
 * Update customer statement with new transaction
 * Maintains running balance for customer account
 */
export async function updateCustomerStatement(
  tx: Prisma.TransactionClient,
  input: UpdateStatementInput
): Promise<void> {
  // Get current customer balance
  const customer = await tx.customer.findUnique({
    where: { id: input.customerId },
    select: { balance: true },
  });

  if (!customer) {
    throw new Error(`Customer ${input.customerId} not found`);
  }

  // Calculate new balance based on transaction type
  // Debit = increases customer debt (invoice)
  // Credit = reduces customer debt (payment)
  const balance = customer.balance.toNumber();

  // Create statement entry
  await tx.customerStatement.create({
    data: {
      customerId: input.customerId,
      transactionDate: input.transactionDate,
      transactionType: input.transactionType,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      referenceNumber: input.referenceNumber,
      debit: input.debit || 0,
      credit: input.credit || 0,
      balance,
      description: input.description,
    },
  });
}

/**
 * Get customer statement for a date range
 */
export async function getCustomerStatement(
  customerId: string,
  startDate: Date,
  endDate: Date
) {
  const prisma = new (require('@prisma/client').PrismaClient)();
  
  const statements = await prisma.customerStatement.findMany({
    where: {
      customerId,
      transactionDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: {
      transactionDate: 'asc',
    },
  });

  return statements;
}
