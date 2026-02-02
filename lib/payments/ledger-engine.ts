/**
 * Kelly OS - Double-Entry Ledger Engine
 * Implements proper accounting principles for financial integrity
 */

import { Prisma, SourceType } from '@prisma/client';
import { LedgerPostingInput } from './types';

/**
 * Post entry to double-entry ledger
 * This ensures every financial transaction is recorded twice (debit & credit)
 * Critical for audit trails and financial accuracy
 */
export async function postToLedger(
  tx: Prisma.TransactionClient,
  input: LedgerPostingInput
): Promise<void> {
  // Generate entry number
  const entryNumber = await generateEntryNumber(tx);

  // Get accounts
  const debitAccount = await tx.account.findUnique({
    where: { code: input.debitAccountCode },
  });

  const creditAccount = await tx.account.findUnique({
    where: { code: input.creditAccountCode },
  });

  if (!debitAccount) {
    throw new Error(`Debit account ${input.debitAccountCode} not found`);
  }

  if (!creditAccount) {
    throw new Error(`Credit account ${input.creditAccountCode} not found`);
  }

  // Create ledger entry
  await tx.ledgerEntry.create({
    data: {
      entryNumber,
      debitAccountId: debitAccount.id,
      creditAccountId: creditAccount.id,
      amount: input.amount,
      sourceType: input.sourceType as SourceType,
      sourceId: input.sourceId,
      customerId: input.customerId,
      invoiceId: input.invoiceId,
      paymentId: input.paymentId,
      description: input.description,
      reference: input.reference,
      branch: input.branch,
      postedBy: input.postedBy,
      postDate: new Date(),
    },
  });

  // Update account balances
  // Assets and Expenses increase with debits
  // Liabilities, Equity, and Revenue increase with credits
  if (['ASSET', 'EXPENSE'].includes(debitAccount.type)) {
    await tx.account.update({
      where: { id: debitAccount.id },
      data: { balance: { increment: input.amount } },
    });
  } else {
    await tx.account.update({
      where: { id: debitAccount.id },
      data: { balance: { decrement: input.amount } },
    });
  }

  if (['LIABILITY', 'EQUITY', 'REVENUE'].includes(creditAccount.type)) {
    await tx.account.update({
      where: { id: creditAccount.id },
      data: { balance: { increment: input.amount } },
    });
  } else {
    await tx.account.update({
      where: { id: creditAccount.id },
      data: { balance: { decrement: input.amount } },
    });
  }
}

/**
 * Generate unique entry number
 * Format: LE-YYYYMMDD-XXXX
 */
async function generateEntryNumber(tx: Prisma.TransactionClient): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  
  const count = await tx.ledgerEntry.count({
    where: {
      createdAt: {
        gte: new Date(today.setHours(0, 0, 0, 0)),
        lt: new Date(today.setHours(23, 59, 59, 999)),
      },
    },
  });

  const sequence = String(count + 1).padStart(4, '0');
  return `LE-${dateStr}-${sequence}`;
}

/**
 * Standard chart of accounts initialization
 * Run this once to set up the accounting structure
 */
export async function initializeChartOfAccounts(
  tx: Prisma.TransactionClient
): Promise<void> {
  const accounts = [
    // Assets
    { code: 'CASH', name: 'Cash on Hand', type: 'ASSET' },
    { code: 'BANK', name: 'Bank Account', type: 'ASSET' },
    { code: 'MPESA', name: 'M-Pesa Account', type: 'ASSET' },
    { code: 'EAZYPAY', name: 'Equity Eazypay Account', type: 'ASSET' },
    { code: 'ACCOUNTS_RECEIVABLE', name: 'Accounts Receivable', type: 'ASSET' },
    { code: 'INVENTORY', name: 'Inventory', type: 'ASSET' },
    
    // Liabilities
    { code: 'ACCOUNTS_PAYABLE', name: 'Accounts Payable', type: 'LIABILITY' },
    { code: 'CUSTOMER_DEPOSITS', name: 'Customer Deposits', type: 'LIABILITY' },
    
    // Equity
    { code: 'OWNERS_EQUITY', name: 'Owner\'s Equity', type: 'EQUITY' },
    { code: 'RETAINED_EARNINGS', name: 'Retained Earnings', type: 'EQUITY' },
    
    // Revenue
    { code: 'SALES_REVENUE', name: 'Sales Revenue', type: 'REVENUE' },
    { code: 'SERVICE_REVENUE', name: 'Service Revenue', type: 'REVENUE' },
    
    // Expenses
    { code: 'COST_OF_GOODS_SOLD', name: 'Cost of Goods Sold', type: 'EXPENSE' },
    { code: 'OPERATING_EXPENSES', name: 'Operating Expenses', type: 'EXPENSE' },
    { code: 'BANK_CHARGES', name: 'Bank Charges', type: 'EXPENSE' },
    { code: 'MPESA_CHARGES', name: 'M-Pesa Transaction Charges', type: 'EXPENSE' },
  ];

  for (const account of accounts) {
    await tx.account.upsert({
      where: { code: account.code },
      update: {},
      create: account,
    });
  }
}
