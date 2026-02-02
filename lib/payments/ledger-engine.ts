/**
 * Kelly OS - Double-Entry Ledger Engine
 * Implements proper accounting principles for financial integrity
 */

import { Prisma, SourceType, AccountType } from '@prisma/client';
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
  const accounts: Array<{ code: string; name: string; type: AccountType }> = [
    // Assets
    { code: 'CASH', name: 'Cash on Hand', type: AccountType.ASSET },
    { code: 'BANK', name: 'Bank Account', type: AccountType.ASSET },
    { code: 'MPESA', name: 'M-Pesa Account', type: AccountType.ASSET },
    { code: 'EAZYPAY', name: 'Equity Eazypay Account', type: AccountType.ASSET },
    { code: 'ACCOUNTS_RECEIVABLE', name: 'Accounts Receivable', type: AccountType.ASSET },
    { code: 'INVENTORY', name: 'Inventory', type: AccountType.ASSET },
    
    // Liabilities
    { code: 'ACCOUNTS_PAYABLE', name: 'Accounts Payable', type: AccountType.LIABILITY },
    { code: 'CUSTOMER_DEPOSITS', name: 'Customer Deposits', type: AccountType.LIABILITY },
    
    // Equity
    { code: 'OWNERS_EQUITY', name: 'Owner\'s Equity', type: AccountType.EQUITY },
    { code: 'RETAINED_EARNINGS', name: 'Retained Earnings', type: AccountType.EQUITY },
    
    // Revenue
    { code: 'SALES_REVENUE', name: 'Sales Revenue', type: AccountType.REVENUE },
    { code: 'SERVICE_REVENUE', name: 'Service Revenue', type: AccountType.REVENUE },
    
    // Expenses
    { code: 'COST_OF_GOODS_SOLD', name: 'Cost of Goods Sold', type: AccountType.EXPENSE },
    { code: 'OPERATING_EXPENSES', name: 'Operating Expenses', type: AccountType.EXPENSE },
    { code: 'BANK_CHARGES', name: 'Bank Charges', type: AccountType.EXPENSE },
    { code: 'MPESA_CHARGES', name: 'M-Pesa Transaction Charges', type: AccountType.EXPENSE },
  ];

  for (const account of accounts) {
    await tx.account.upsert({
      where: { code: account.code },
      update: {},
      create: account,
    });
  }
}
