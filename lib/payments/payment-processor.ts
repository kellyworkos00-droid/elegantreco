/**
 * Kelly OS - Payment Processing Core
 * Handles payment creation, allocation, and balance updates
 * This is the heart of the reconciliation engine
 */

import { PrismaClient, PaymentStatus, InvoiceStatus, Prisma } from '@prisma/client';
import { 
  CreatePaymentInput, 
  AllocatePaymentInput, 
  PaymentResult 
} from './types';
import { postToLedger } from './ledger-engine';
import { updateCustomerStatement } from './statement-engine';

const prisma = new PrismaClient();

/**
 * Main payment processing function
 * This handles the complete payment lifecycle:
 * 1. Create payment record
 * 2. Allocate to invoices
 * 3. Update customer balance
 * 4. Post to ledger
 * 5. Update statement
 */
export async function processPayment(
  input: CreatePaymentInput,
  allocations?: Array<{ invoiceId: string; amount: number }>
): Promise<PaymentResult> {
  try {
    // Use transaction to ensure atomicity - critical for financial data
    const result = await prisma.$transaction(async (tx) => {
      // 1. Generate payment number
      const paymentNumber = await generatePaymentNumber(tx);

      // 2. Create payment record
      const payment = await tx.payment.create({
        data: {
          paymentNumber,
          customerId: input.customerId,
          amount: input.amount,
          allocatedAmount: 0,
          unallocatedAmount: input.amount,
          paymentMethod: input.paymentMethod,
          paymentDate: input.paymentDate || new Date(),
          transactionId: input.transactionId,
          reference: input.reference,
          source: input.source,
          sourceDetails: input.sourceDetails || {},
          status: PaymentStatus.COMPLETED,
          branch: input.branch,
          notes: input.notes,
          receiptNumber: input.receiptNumber,
        },
      });

      // 3. Allocate payment to invoices
      let totalAllocated = 0;
      if (allocations && allocations.length > 0) {
        for (const allocation of allocations) {
          await allocatePaymentToInvoice(tx, {
            paymentId: payment.id,
            invoiceId: allocation.invoiceId,
            amount: allocation.amount,
          });
          totalAllocated += allocation.amount;
        }
      } else {
        // Auto-allocate to oldest unpaid invoices
        totalAllocated = await autoAllocatePayment(tx, payment.id, input.customerId, input.amount);
      }

      // 4. Update payment allocated amounts
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          allocatedAmount: totalAllocated,
          unallocatedAmount: input.amount - totalAllocated,
        },
      });

      // 5. Update customer balance (reduce debt)
      await tx.customer.update({
        where: { id: input.customerId },
        data: {
          balance: {
            decrement: input.amount,
          },
        },
      });

      // 6. Post to ledger (double-entry)
      await postToLedger(tx, {
        debitAccountCode: getPaymentAccountCode(input.paymentMethod),
        creditAccountCode: 'ACCOUNTS_RECEIVABLE',
        amount: input.amount,
        description: `Payment received - ${paymentNumber}`,
        sourceType: 'PAYMENT',
        sourceId: payment.id,
        customerId: input.customerId,
        paymentId: payment.id,
        reference: input.reference,
        branch: input.branch,
        postedBy: 'SYSTEM',
      });

      // 7. Update customer statement
      await updateCustomerStatement(tx, {
        customerId: input.customerId,
        transactionDate: payment.paymentDate,
        transactionType: 'PAYMENT',
        referenceType: 'Payment',
        referenceId: payment.id,
        referenceNumber: paymentNumber,
        credit: input.amount,
        description: `Payment - ${input.paymentMethod}${input.transactionId ? ` - ${input.transactionId}` : ''}`,
      });

      return {
        success: true,
        paymentId: payment.id,
        paymentNumber: payment.paymentNumber,
        message: `Payment processed successfully. Amount: KES ${input.amount}`,
      };
    });

    return result;
  } catch (error) {
    console.error('Payment processing error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Allocate payment to specific invoice
 */
async function allocatePaymentToInvoice(
  tx: Prisma.TransactionClient,
  input: AllocatePaymentInput
): Promise<void> {
  // Get invoice
  const invoice = await tx.invoice.findUnique({
    where: { id: input.invoiceId },
  });

  if (!invoice) {
    throw new Error(`Invoice ${input.invoiceId} not found`);
  }

  // Check if amount exceeds invoice balance
  if (input.amount > invoice.balance.toNumber()) {
    throw new Error(`Allocation amount exceeds invoice balance`);
  }

  // Create allocation
  await tx.paymentAllocation.create({
    data: {
      paymentId: input.paymentId,
      invoiceId: input.invoiceId,
      amount: input.amount,
    },
  });

  // Update invoice amounts
  const newPaidAmount = invoice.paidAmount.toNumber() + input.amount;
  const newBalance = invoice.balance.toNumber() - input.amount;

  await tx.invoice.update({
    where: { id: input.invoiceId },
    data: {
      paidAmount: newPaidAmount,
      balance: newBalance,
      status: newBalance === 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID,
      paidDate: newBalance === 0 ? new Date() : null,
    },
  });
}

/**
 * Auto-allocate payment to oldest unpaid invoices (FIFO)
 * This is critical for Kenyan businesses - oldest debts paid first
 */
async function autoAllocatePayment(
  tx: Prisma.TransactionClient,
  paymentId: string,
  customerId: string,
  amount: number
): Promise<number> {
  // Get unpaid invoices ordered by date (oldest first)
  const invoices = await tx.invoice.findMany({
    where: {
      customerId,
      status: {
        in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
      },
      balance: {
        gt: 0,
      },
    },
    orderBy: [
      { dueDate: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  let remainingAmount = amount;
  let totalAllocated = 0;

  for (const invoice of invoices) {
    if (remainingAmount <= 0) break;

    const invoiceBalance = invoice.balance.toNumber();
    const allocationAmount = Math.min(remainingAmount, invoiceBalance);

    await allocatePaymentToInvoice(tx, {
      paymentId,
      invoiceId: invoice.id,
      amount: allocationAmount,
    });

    remainingAmount -= allocationAmount;
    totalAllocated += allocationAmount;
  }

  return totalAllocated;
}

/**
 * Generate unique payment number
 * Format: PAY-YYYYMMDD-XXXX
 */
async function generatePaymentNumber(tx: Prisma.TransactionClient): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  
  // Get today's payment count
  const count = await tx.payment.count({
    where: {
      createdAt: {
        gte: new Date(today.setHours(0, 0, 0, 0)),
        lt: new Date(today.setHours(23, 59, 59, 999)),
      },
    },
  });

  const sequence = String(count + 1).padStart(4, '0');
  return `PAY-${dateStr}-${sequence}`;
}

/**
 * Map payment method to ledger account code
 */
function getPaymentAccountCode(method: string): string {
  const mapping: Record<string, string> = {
    CASH: 'CASH',
    MPESA: 'MPESA',
    EAZYPAY: 'EAZYPAY',
    BANK_TRANSFER: 'BANK',
    CHEQUE: 'BANK',
    OTHER: 'CASH',
  };
  return mapping[method] || 'CASH';
}

/**
 * Reverse a payment (for corrections/cancellations)
 */
export async function reversePayment(
  paymentId: string,
  reason: string,
  reversedBy: string
): Promise<PaymentResult> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Get payment with allocations
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: {
          allocations: {
            include: {
              invoice: true,
            },
          },
          customer: true,
        },
      });

      if (!payment) {
        throw new Error('Payment not found');
      }

      if (payment.status === PaymentStatus.CANCELLED) {
        throw new Error('Payment already cancelled');
      }

      // Reverse allocations
      for (const allocation of payment.allocations) {
        await tx.invoice.update({
          where: { id: allocation.invoiceId },
          data: {
            paidAmount: {
              decrement: allocation.amount,
            },
            balance: {
              increment: allocation.amount,
            },
            status: InvoiceStatus.PENDING,
            paidDate: null,
          },
        });
      }

      // Delete allocations
      await tx.paymentAllocation.deleteMany({
        where: { paymentId },
      });

      // Update payment status
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.CANCELLED,
          notes: payment.notes ? `${payment.notes}\n\nREVERSED: ${reason}` : `REVERSED: ${reason}`,
        },
      });

      // Restore customer balance
      await tx.customer.update({
        where: { id: payment.customerId },
        data: {
          balance: {
            increment: payment.amount,
          },
        },
      });

      // Reverse ledger entry
      await postToLedger(tx, {
        debitAccountCode: 'ACCOUNTS_RECEIVABLE',
        creditAccountCode: getPaymentAccountCode(payment.paymentMethod),
        amount: payment.amount.toNumber(),
        description: `Payment reversal - ${payment.paymentNumber} - ${reason}`,
        sourceType: 'PAYMENT',
        sourceId: payment.id,
        customerId: payment.customerId,
        paymentId: payment.id,
        branch: payment.branch || undefined,
        postedBy: reversedBy,
      });

      return {
        success: true,
        paymentId: payment.id,
        message: 'Payment reversed successfully',
      };
    });

    return result;
  } catch (error) {
    console.error('Payment reversal error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
