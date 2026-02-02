/**
 * Kelly OS - POS Integration Service
 * Handles point-of-sale transactions with automatic payment matching
 */

import { PrismaClient, PaymentMethod, PaymentStatus, InvoiceStatus } from '@prisma/client';
import { CreatePosSaleInput, CreateInvoiceInput } from './types';
import { postToLedger } from './ledger-engine';
import { updateCustomerStatement } from './statement-engine';

const prisma = new PrismaClient();

/**
 * Create POS sale with invoice
 * Handles both cash and electronic payments
 */
export async function createPosSale(input: CreatePosSaleInput) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Calculate totals
      const subtotal = input.items.reduce((sum, item) => 
        sum + (item.quantity * item.unitPrice), 0
      );
      const tax = subtotal * 0.16; // 16% VAT (Kenyan standard)
      const total = subtotal + tax;

      // 2. Generate sale number
      const saleNumber = await generateSaleNumber(tx);

      // 3. Create invoice for the sale
      const invoiceNumber = await generateInvoiceNumber(tx);
      
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          customerId: input.customerId,
          subtotal,
          tax,
          discount: 0,
          total,
          balance: total,
          paidAmount: 0,
          status: InvoiceStatus.PENDING,
          branch: input.branch,
          notes: input.notes,
          createdBy: input.cashier,
          items: {
            create: input.items.map(item => ({
              productId: item.productId,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              tax: item.unitPrice * item.quantity * 0.16,
              discount: 0,
              total: item.unitPrice * item.quantity * 1.16,
            })),
          },
        },
      });

      // 4. Create POS sale record
      const posSale = await tx.posSale.create({
        data: {
          saleNumber,
          customerId: input.customerId,
          invoiceId: invoice.id,
          total,
          balance: total,
          paidAmount: 0,
          paymentMethod: input.paymentMethod,
          paymentStatus: input.paymentMethod === PaymentMethod.CASH 
            ? PaymentStatus.COMPLETED 
            : PaymentStatus.PENDING,
          branch: input.branch,
          terminal: input.terminal,
          cashier: input.cashier,
          notes: input.notes,
          completedAt: input.paymentMethod === PaymentMethod.CASH ? new Date() : null,
          items: {
            create: input.items.map(item => ({
              productId: item.productId,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.unitPrice * item.quantity * 1.16,
            })),
          },
        },
      });

      // 5. If cash payment, complete immediately
      if (input.paymentMethod === PaymentMethod.CASH) {
        await completePosSale(tx, posSale.id, total, 'CASH', input.cashier);
      }

      // 6. Update customer balance (increase debt)
      await tx.customer.update({
        where: { id: input.customerId },
        data: {
          balance: { increment: total },
        },
      });

      // 7. Post to ledger
      await postToLedger(tx, {
        debitAccountCode: 'ACCOUNTS_RECEIVABLE',
        creditAccountCode: 'SALES_REVENUE',
        amount: subtotal,
        description: `POS Sale - ${saleNumber}`,
        sourceType: 'SALE',
        sourceId: posSale.id,
        customerId: input.customerId,
        invoiceId: invoice.id,
        branch: input.branch,
        postedBy: input.cashier,
      });

      // Post tax separately
      if (tax > 0) {
        await postToLedger(tx, {
          debitAccountCode: 'ACCOUNTS_RECEIVABLE',
          creditAccountCode: 'SALES_REVENUE',
          amount: tax,
          description: `VAT - ${saleNumber}`,
          sourceType: 'SALE',
          sourceId: posSale.id,
          customerId: input.customerId,
          branch: input.branch,
          postedBy: input.cashier,
        });
      }

      // 8. Update customer statement
      await updateCustomerStatement(tx, {
        customerId: input.customerId,
        transactionDate: new Date(),
        transactionType: 'INVOICE',
        referenceType: 'Sale',
        referenceId: posSale.id,
        referenceNumber: saleNumber,
        debit: total,
        description: `POS Sale - ${input.paymentMethod}${input.paymentMethod !== PaymentMethod.CASH ? ' (Pending)' : ''}`,
      });

      return {
        success: true,
        saleId: posSale.id,
        saleNumber: posSale.saleNumber,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        total,
        paymentStatus: posSale.paymentStatus,
        message: input.paymentMethod === PaymentMethod.CASH 
          ? 'Sale completed successfully'
          : `Sale created. Awaiting ${input.paymentMethod} payment confirmation.`,
      };
    });

    return result;
  } catch (error) {
    console.error('POS sale creation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Complete POS sale (called when payment is confirmed)
 * Used internally by webhook handlers
 */
async function completePosSale(
  tx: any,
  saleId: string,
  amount: number,
  transactionRef: string,
  completedBy: string
) {
  const posSale = await tx.posSale.findUnique({
    where: { id: saleId },
    include: { invoice: true },
  });

  if (!posSale) {
    throw new Error('POS sale not found');
  }

  // Update POS sale
  await tx.posSale.update({
    where: { id: saleId },
    data: {
      paymentStatus: PaymentStatus.COMPLETED,
      paidAmount: amount,
      balance: 0,
      transactionRef,
      completedAt: new Date(),
    },
  });

  // Update invoice
  if (posSale.invoiceId) {
    await tx.invoice.update({
      where: { id: posSale.invoiceId },
      data: {
        status: InvoiceStatus.PAID,
        paidAmount: amount,
        balance: 0,
        paidDate: new Date(),
      },
    });
  }
}

/**
 * Get pending POS sales awaiting payment
 */
export async function getPendingPosSales(branch?: string) {
  return await prisma.posSale.findMany({
    where: {
      paymentStatus: PaymentStatus.PENDING,
      branch: branch || undefined,
    },
    include: {
      customer: {
        select: {
          customerCode: true,
          name: true,
          phone: true,
        },
      },
      invoice: {
        select: {
          invoiceNumber: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
}

/**
 * Cancel POS sale
 */
export async function cancelPosSale(
  saleId: string,
  reason: string,
  cancelledBy: string
) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const posSale = await tx.posSale.findUnique({
        where: { id: saleId },
        include: { invoice: true },
      });

      if (!posSale) {
        throw new Error('POS sale not found');
      }

      if (posSale.paymentStatus === PaymentStatus.COMPLETED) {
        throw new Error('Cannot cancel completed sale. Use reversal instead.');
      }

      // Cancel POS sale
      await tx.posSale.update({
        where: { id: saleId },
        data: {
          paymentStatus: PaymentStatus.CANCELLED,
          notes: posSale.notes 
            ? `${posSale.notes}\n\nCANCELLED: ${reason}` 
            : `CANCELLED: ${reason}`,
        },
      });

      // Cancel invoice
      if (posSale.invoiceId) {
        await tx.invoice.update({
          where: { id: posSale.invoiceId },
          data: {
            status: InvoiceStatus.CANCELLED,
          },
        });
      }

      // Reverse customer balance
      await tx.customer.update({
        where: { id: posSale.customerId },
        data: {
          balance: { decrement: posSale.total },
        },
      });

      // Reverse ledger
      await postToLedger(tx, {
        debitAccountCode: 'SALES_REVENUE',
        creditAccountCode: 'ACCOUNTS_RECEIVABLE',
        amount: posSale.total.toNumber(),
        description: `Sale cancellation - ${posSale.saleNumber} - ${reason}`,
        sourceType: 'SALE',
        sourceId: posSale.id,
        customerId: posSale.customerId,
        branch: posSale.branch,
        postedBy: cancelledBy,
      });

      return {
        success: true,
        message: 'Sale cancelled successfully',
      };
    });

    return result;
  } catch (error) {
    console.error('POS sale cancellation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get POS sales report
 */
export async function getPosSalesReport(
  startDate: Date,
  endDate: Date,
  branch?: string
) {
  const sales = await prisma.posSale.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      branch: branch || undefined,
    },
    include: {
      customer: {
        select: {
          name: true,
        },
      },
    },
  });

  const summary = {
    totalSales: sales.length,
    completedSales: sales.filter(s => s.paymentStatus === PaymentStatus.COMPLETED).length,
    pendingSales: sales.filter(s => s.paymentStatus === PaymentStatus.PENDING).length,
    totalRevenue: sales
      .filter(s => s.paymentStatus === PaymentStatus.COMPLETED)
      .reduce((sum, s) => sum + s.total.toNumber(), 0),
    byPaymentMethod: {} as Record<PaymentMethod, number>,
  };

  // Group by payment method
  for (const sale of sales.filter(s => s.paymentStatus === PaymentStatus.COMPLETED)) {
    const method = sale.paymentMethod;
    summary.byPaymentMethod[method] = (summary.byPaymentMethod[method] || 0) + sale.total.toNumber();
  }

  return {
    summary,
    sales,
  };
}

/**
 * Generate unique sale number
 * Format: SALE-YYYYMMDD-XXXX
 */
async function generateSaleNumber(tx: any): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  
  const count = await tx.posSale.count({
    where: {
      createdAt: {
        gte: new Date(today.setHours(0, 0, 0, 0)),
        lt: new Date(today.setHours(23, 59, 59, 999)),
      },
    },
  });

  const sequence = String(count + 1).padStart(4, '0');
  return `SALE-${dateStr}-${sequence}`;
}

/**
 * Generate unique invoice number
 * Format: INV-YYYYMMDD-XXXX
 */
async function generateInvoiceNumber(tx: any): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  
  const count = await tx.invoice.count({
    where: {
      createdAt: {
        gte: new Date(today.setHours(0, 0, 0, 0)),
        lt: new Date(today.setHours(23, 59, 59, 999)),
      },
    },
  });

  const sequence = String(count + 1).padStart(4, '0');
  return `INV-${dateStr}-${sequence}`;
}
