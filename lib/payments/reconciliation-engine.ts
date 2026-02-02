/**
 * Kelly OS - Bank Statement Reconciliation Engine
 * Fallback mechanism for manual payment matching
 * Handles CSV/Excel uploads and fuzzy matching
 */

import { PrismaClient, Payment, Customer } from '@prisma/client';
import { BankStatementRow, ReconciliationMatch } from './types';

const prisma = new PrismaClient();

type PaymentWithCustomer = Payment & { customer: Customer | null };

/**
 * Process uploaded bank statement
 * Parses transactions and attempts automatic matching
 */
export async function processBankStatement(
  bankName: string,
  accountNumber: string,
  statementDate: Date,
  fileName: string,
  uploadedBy: string,
  transactions: BankStatementRow[]
): Promise<{
  statementId: string;
  totalTransactions: number;
  autoMatched: number;
  unmatchedCount: number;
}> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Create bank statement record
      const statement = await tx.bankStatement.create({
        data: {
          bankName,
          accountNumber,
          statementDate,
          fileName,
          uploadedBy,
        },
      });

      let autoMatched = 0;

      // Process each transaction
      for (const txn of transactions) {
        // Create transaction record
        const bankTxn = await tx.bankTransaction.create({
          data: {
            statementId: statement.id,
            transactionDate: txn.date,
            description: txn.description,
            reference: txn.reference,
            debit: txn.debit,
            credit: txn.credit,
            balance: txn.balance,
          },
        });

        // Attempt automatic matching for credits (incoming payments)
        if (txn.credit > 0) {
          const match = await findPaymentMatch(tx, txn);
          
          if (match && match.confidence === 'high') {
            // Auto-match high confidence matches
            await tx.bankTransaction.update({
              where: { id: bankTxn.id },
              data: {
                matched: true,
                matchedPaymentId: match.paymentId,
                matchScore: match.matchScore,
              },
            });

            // Mark payment as reconciled
            if (match.paymentId) {
              await tx.payment.update({
                where: { id: match.paymentId },
                data: {
                  reconciled: true,
                  reconciledAt: new Date(),
                  reconciledBy: 'AUTO',
                },
              });
            }

            autoMatched++;
          }
        }
      }

      const unmatchedCount = transactions.filter(t => t.credit > 0).length - autoMatched;

      return {
        statementId: statement.id,
        totalTransactions: transactions.length,
        autoMatched,
        unmatchedCount,
      };
    });

    return result;
  } catch (error) {
    console.error('Bank statement processing error:', error);
    throw error;
  }
}

/**
 * Find matching payment for bank transaction
 * Uses fuzzy matching on amount, date, and reference
 */
async function findPaymentMatch(
  tx: any,
  bankTxn: BankStatementRow
): Promise<ReconciliationMatch | null> {
  // Search for payments within ±2 days of transaction date
  const dateFrom = new Date(bankTxn.date);
  dateFrom.setDate(dateFrom.getDate() - 2);
  
  const dateTo = new Date(bankTxn.date);
  dateTo.setDate(dateTo.getDate() + 2);

  // Find unreconciled payments matching amount
  const candidates = await tx.payment.findMany({
    where: {
      amount: bankTxn.credit,
      paymentDate: {
        gte: dateFrom,
        lte: dateTo,
      },
      reconciled: false,
      status: 'COMPLETED',
    },
    include: {
      customer: true,
    },
  });

  if (candidates.length === 0) {
    return null;
  }

  // Calculate match scores
  const matches: ReconciliationMatch[] = candidates.map((payment: PaymentWithCustomer) => {
    let score = 0;
    
    // Exact amount match (critical)
    if (payment.amount.toNumber() === bankTxn.credit) {
      score += 50;
    }

    // Date proximity (same day = 30, next day = 20, 2 days = 10)
    const daysDiff = Math.abs(
      (bankTxn.date.getTime() - payment.paymentDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysDiff === 0) score += 30;
    else if (daysDiff === 1) score += 20;
    else if (daysDiff === 2) score += 10;

    // Reference matching
    if (bankTxn.reference) {
      const ref = bankTxn.reference.toLowerCase();
      const desc = bankTxn.description.toLowerCase();
      
      // Check transaction ID
      if (payment.transactionId && (
        ref.includes(payment.transactionId.toLowerCase()) ||
        desc.includes(payment.transactionId.toLowerCase())
      )) {
        score += 15;
      }

      // Check customer code
      if (payment.customer && (
        ref.includes(payment.customer.customerCode.toLowerCase()) ||
        desc.includes(payment.customer.customerCode.toLowerCase())
      )) {
        score += 10;
      }

      // Check customer name
      if (payment.customer && (
        desc.includes(payment.customer.name.toLowerCase().substring(0, 10))
      )) {
        score += 5;
      }
    }

    // Determine confidence level
    let confidence: 'high' | 'medium' | 'low';
    if (score >= 80) confidence = 'high';
    else if (score >= 60) confidence = 'medium';
    else confidence = 'low';

    return {
      transactionId: bankTxn.reference || '',
      paymentId: payment.id,
      customerId: payment.customerId,
      amount: bankTxn.credit,
      matchScore: score,
      matchType: 'fuzzy',
      confidence,
    };
  });

  // Return best match
  matches.sort((a, b) => b.matchScore - a.matchScore);
  return matches[0] || null;
}

/**
 * Get unmatched bank transactions for manual review
 */
export async function getUnmatchedTransactions(statementId: string) {
  return await prisma.bankTransaction.findMany({
    where: {
      statementId,
      matched: false,
      credit: { gt: 0 }, // Only incoming payments
    },
    orderBy: {
      transactionDate: 'desc',
    },
  });
}

/**
 * Get suggested matches for manual reconciliation
 */
export async function getSuggestedMatches(
  transactionId: string
): Promise<ReconciliationMatch[]> {
  const transaction = await prisma.bankTransaction.findUnique({
    where: { id: transactionId },
  });

  if (!transaction || !transaction.credit) {
    return [];
  }

  // Search wider date range for manual matching
  const dateFrom = new Date(transaction.transactionDate);
  dateFrom.setDate(dateFrom.getDate() - 7);
  
  const dateTo = new Date(transaction.transactionDate);
  dateTo.setDate(dateTo.getDate() + 7);

  const payments = await prisma.payment.findMany({
    where: {
      amount: {
        gte: transaction.credit * 0.95, // Allow 5% variance
        lte: transaction.credit * 1.05,
      },
      paymentDate: {
        gte: dateFrom,
        lte: dateTo,
      },
      reconciled: false,
      status: 'COMPLETED',
    },
    include: {
      customer: true,
    },
    take: 10,
  });

  const bankTxn: BankStatementRow = {
    date: transaction.transactionDate,
    description: transaction.description,
    reference: transaction.reference || undefined,
    debit: transaction.debit.toNumber(),
    credit: transaction.credit.toNumber(),
    balance: transaction.balance.toNumber(),
  };

  // Use findPaymentMatch logic without transaction wrapper
  const matches: ReconciliationMatch[] = payments.map(payment => {
    let score = 0;
    
    // Amount match (with tolerance)
    const amountDiff = Math.abs(payment.amount.toNumber() - bankTxn.credit);
    const amountTolerance = bankTxn.credit * 0.05;
    if (amountDiff === 0) score += 50;
    else if (amountDiff <= amountTolerance) score += 40;

    // Date proximity
    const daysDiff = Math.abs(
      (bankTxn.date.getTime() - payment.paymentDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysDiff <= 1) score += 30;
    else if (daysDiff <= 3) score += 20;
    else if (daysDiff <= 7) score += 10;

    // Reference matching
    if (bankTxn.reference) {
      const ref = bankTxn.reference.toLowerCase();
      const desc = bankTxn.description.toLowerCase();
      
      if (payment.transactionId && (
        ref.includes(payment.transactionId.toLowerCase()) ||
        desc.includes(payment.transactionId.toLowerCase())
      )) {
        score += 15;
      }

      if (payment.customer && (
        ref.includes(payment.customer.customerCode.toLowerCase()) ||
        desc.includes(payment.customer.customerCode.toLowerCase())
      )) {
        score += 10;
      }
    }

    let confidence: 'high' | 'medium' | 'low';
    if (score >= 70) confidence = 'high';
    else if (score >= 50) confidence = 'medium';
    else confidence = 'low';

    return {
      transactionId: bankTxn.reference || '',
      paymentId: payment.id,
      customerId: payment.customerId,
      amount: bankTxn.credit,
      matchScore: score,
      matchType: 'fuzzy',
      confidence,
    };
  });

  return matches.sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Manually approve a match
 */
export async function approveMatch(
  transactionId: string,
  paymentId: string,
  approvedBy: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Update bank transaction
    await tx.bankTransaction.update({
      where: { id: transactionId },
      data: {
        matched: true,
        matchedPaymentId: paymentId,
        approved: true,
        approvedBy,
        approvedAt: new Date(),
      },
    });

    // Mark payment as reconciled
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        reconciled: true,
        reconciledAt: new Date(),
        reconciledBy: approvedBy,
      },
    });
  });
}

/**
 * Parse CSV bank statement
 * Supports common Kenyan bank formats (Equity, KCB, Co-op, etc.)
 */
export function parseBankStatementCSV(csvContent: string): BankStatementRow[] {
  const rows = csvContent.split('\n').map(line => line.trim()).filter(Boolean);
  
  // Remove header row (assuming first row is header)
  const dataRows = rows.slice(1);
  
  const transactions: BankStatementRow[] = [];

  for (const row of dataRows) {
    // Parse CSV (handle quoted fields)
    const fields = parseCSVRow(row);
    
    if (fields.length < 5) continue;

    // Common format: Date, Description, Reference, Debit, Credit, Balance
    // Adjust indices based on your bank's format
    try {
      const transaction: BankStatementRow = {
        date: parseDate(fields[0]),
        description: fields[1] || '',
        reference: fields[2] || undefined,
        debit: parseFloat(fields[3]?.replace(/,/g, '') || '0'),
        credit: parseFloat(fields[4]?.replace(/,/g, '') || '0'),
        balance: parseFloat(fields[5]?.replace(/,/g, '') || '0'),
      };

      transactions.push(transaction);
    } catch (error) {
      console.error('Error parsing row:', row, error);
    }
  }

  return transactions;
}

/**
 * Parse CSV row handling quoted fields
 */
function parseCSVRow(row: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

/**
 * Parse date from various formats
 */
function parseDate(dateStr: string): Date {
  // Try common formats: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
  const formats = [
    /(\d{2})\/(\d{2})\/(\d{4})/, // DD/MM/YYYY
    /(\d{2})-(\d{2})-(\d{4})/, // DD-MM-YYYY
    /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
  ];

  for (const format of formats) {
    const match = dateStr.match(format);
    if (match) {
      if (format === formats[2]) {
        // YYYY-MM-DD
        return new Date(`${match[1]}-${match[2]}-${match[3]}`);
      } else {
        // DD/MM/YYYY or DD-MM-YYYY
        return new Date(`${match[3]}-${match[2]}-${match[1]}`);
      }
    }
  }

  // Fallback to Date.parse
  return new Date(dateStr);
}
