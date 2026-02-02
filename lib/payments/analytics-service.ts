/**
 * Kelly OS - Analytics & Dashboard Service
 * Provides real-time insights into payments, collections, and customer balances
 */

import { PrismaClient, PaymentMethod, InvoiceStatus } from '@prisma/client';
import { PaymentAnalytics, CustomerBalanceSummary } from './types';

const prisma = new PrismaClient();

/**
 * Get payment analytics dashboard
 */
export async function getPaymentAnalytics(
  startDate: Date,
  endDate: Date,
  branch?: string
): Promise<PaymentAnalytics> {
  // Get all payments in date range
  const payments = await prisma.payment.findMany({
    where: {
      paymentDate: {
        gte: startDate,
        lte: endDate,
      },
      status: 'COMPLETED',
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

  // Calculate totals
  const totalCollected = payments.reduce((sum, p) => sum + p.amount.toNumber(), 0);

  // Get pending amounts
  const pendingInvoices = await prisma.invoice.findMany({
    where: {
      status: {
        in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
      },
      branch: branch || undefined,
    },
  });

  const totalPending = pendingInvoices.reduce((sum, inv) => sum + inv.balance.toNumber(), 0);

  // Group by payment method
  const paymentsByMethod: Record<PaymentMethod, number> = {} as any;
  for (const payment of payments) {
    const method = payment.paymentMethod;
    paymentsByMethod[method] = (paymentsByMethod[method] || 0) + payment.amount.toNumber();
  }

  // Daily collections
  const dailyMap = new Map<string, number>();
  for (const payment of payments) {
    const dateKey = payment.paymentDate.toISOString().split('T')[0];
    dailyMap.set(dateKey, (dailyMap.get(dateKey) || 0) + payment.amount.toNumber());
  }

  const dailyCollections = Array.from(dailyMap.entries())
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Top customers by payment amount
  const customerMap = new Map<string, { name: string; total: number }>();
  for (const payment of payments) {
    const existing = customerMap.get(payment.customerId);
    if (existing) {
      existing.total += payment.amount.toNumber();
    } else {
      customerMap.set(payment.customerId, {
        name: payment.customer.name,
        total: payment.amount.toNumber(),
      });
    }
  }

  const topCustomers = Array.from(customerMap.entries())
    .map(([customerId, data]) => ({
      customerId,
      customerName: data.name,
      totalPaid: data.total,
    }))
    .sort((a, b) => b.totalPaid - a.totalPaid)
    .slice(0, 10);

  return {
    totalCollected,
    totalPending,
    paymentsByMethod,
    dailyCollections,
    topCustomers,
  };
}

/**
 * Get customer balance summaries
 */
export async function getCustomerBalances(
  branch?: string,
  includeZeroBalance: boolean = false
): Promise<CustomerBalanceSummary[]> {
  const customers = await prisma.customer.findMany({
    where: {
      branch: branch || undefined,
      balance: includeZeroBalance ? undefined : { gt: 0 },
      status: 'ACTIVE',
    },
    include: {
      invoices: {
        where: {
          status: {
            in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
          },
        },
      },
    },
    orderBy: {
      balance: 'desc',
    },
  });

  const summaries: CustomerBalanceSummary[] = customers.map(customer => {
    const balance = customer.balance.toNumber();
    const creditLimit = customer.creditLimit.toNumber();
    const availableCredit = creditLimit - balance;

    // Calculate overdue vs current
    const today = new Date();
    let overdueAmount = 0;
    let currentAmount = 0;

    for (const invoice of customer.invoices) {
      const invBalance = invoice.balance.toNumber();
      if (invoice.dueDate && invoice.dueDate < today) {
        overdueAmount += invBalance;
      } else {
        currentAmount += invBalance;
      }
    }

    return {
      customerId: customer.id,
      customerName: customer.name,
      balance,
      creditLimit,
      availableCredit,
      overdueAmount,
      currentAmount,
    };
  });

  return summaries;
}

/**
 * Get overdue invoices report
 */
export async function getOverdueInvoices(branch?: string) {
  const today = new Date();
  
  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      status: {
        in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE],
      },
      dueDate: {
        lt: today,
      },
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
    },
    orderBy: {
      dueDate: 'asc',
    },
  });

  // Group by aging periods
  const aging = {
    current: 0,
    days30: 0,
    days60: 0,
    days90: 0,
    days90Plus: 0,
  };

  for (const invoice of overdueInvoices) {
    const daysOverdue = Math.floor(
      (today.getTime() - (invoice.dueDate?.getTime() || 0)) / (1000 * 60 * 60 * 24)
    );
    const balance = invoice.balance.toNumber();

    if (daysOverdue <= 0) {
      aging.current += balance;
    } else if (daysOverdue <= 30) {
      aging.days30 += balance;
    } else if (daysOverdue <= 60) {
      aging.days60 += balance;
    } else if (daysOverdue <= 90) {
      aging.days90 += balance;
    } else {
      aging.days90Plus += balance;
    }
  }

  return {
    invoices: overdueInvoices,
    aging,
    totalOverdue: overdueInvoices.reduce((sum, inv) => sum + inv.balance.toNumber(), 0),
  };
}

/**
 * Get payment reconciliation status
 */
export async function getReconciliationStatus(branch?: string) {
  const [
    totalPayments,
    reconciledPayments,
    unreconciledPayments,
    pendingWebhooks,
  ] = await Promise.all([
    prisma.payment.count({
      where: {
        status: 'COMPLETED',
        branch: branch || undefined,
      },
    }),
    prisma.payment.count({
      where: {
        status: 'COMPLETED',
        reconciled: true,
        branch: branch || undefined,
      },
    }),
    prisma.payment.count({
      where: {
        status: 'COMPLETED',
        reconciled: false,
        branch: branch || undefined,
      },
    }),
    prisma.webhookEvent.count({
      where: {
        processed: false,
      },
    }),
  ]);

  const reconciliationRate = totalPayments > 0 
    ? (reconciledPayments / totalPayments) * 100 
    : 0;

  return {
    totalPayments,
    reconciledPayments,
    unreconciledPayments,
    pendingWebhooks,
    reconciliationRate: reconciliationRate.toFixed(2),
  };
}

/**
 * Get invoice status breakdown
 */
export async function getInvoiceStatusBreakdown(branch?: string) {
  const invoices = await prisma.invoice.findMany({
    where: {
      branch: branch || undefined,
    },
  });

  const breakdown = {
    total: invoices.length,
    paid: 0,
    partiallyPaid: 0,
    pending: 0,
    overdue: 0,
    cancelled: 0,
    totalAmount: 0,
    paidAmount: 0,
    balanceAmount: 0,
  };

  for (const invoice of invoices) {
    breakdown.totalAmount += invoice.total.toNumber();
    breakdown.paidAmount += invoice.paidAmount.toNumber();
    breakdown.balanceAmount += invoice.balance.toNumber();

    switch (invoice.status) {
      case InvoiceStatus.PAID:
        breakdown.paid++;
        break;
      case InvoiceStatus.PARTIALLY_PAID:
        breakdown.partiallyPaid++;
        break;
      case InvoiceStatus.PENDING:
        breakdown.pending++;
        break;
      case InvoiceStatus.OVERDUE:
        breakdown.overdue++;
        break;
      case InvoiceStatus.CANCELLED:
        breakdown.cancelled++;
        break;
    }
  }

  return breakdown;
}

/**
 * Get collection efficiency metrics
 */
export async function getCollectionMetrics(
  startDate: Date,
  endDate: Date,
  branch?: string
) {
  const [payments, invoices] = await Promise.all([
    prisma.payment.findMany({
      where: {
        paymentDate: {
          gte: startDate,
          lte: endDate,
        },
        status: 'COMPLETED',
        branch: branch || undefined,
      },
    }),
    prisma.invoice.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        branch: branch || undefined,
      },
    }),
  ]);

  const totalInvoiced = invoices.reduce((sum, inv) => sum + inv.total.toNumber(), 0);
  const totalCollected = payments.reduce((sum, p) => sum + p.amount.toNumber(), 0);
  
  const collectionRate = totalInvoiced > 0 
    ? (totalCollected / totalInvoiced) * 100 
    : 0;

  // Average days to payment
  const paidInvoices = invoices.filter(inv => inv.paidDate);
  const avgDaysToPayment = paidInvoices.length > 0
    ? paidInvoices.reduce((sum, inv) => {
        const days = Math.floor(
          ((inv.paidDate?.getTime() || 0) - inv.createdAt.getTime()) / (1000 * 60 * 60 * 24)
        );
        return sum + days;
      }, 0) / paidInvoices.length
    : 0;

  return {
    totalInvoiced,
    totalCollected,
    collectionRate: collectionRate.toFixed(2),
    avgDaysToPayment: avgDaysToPayment.toFixed(1),
    invoiceCount: invoices.length,
    paymentCount: payments.length,
  };
}

/**
 * Get real-time system health
 */
export async function getSystemHealth() {
  const [
    activeCustomers,
    todayPayments,
    pendingPosSales,
    failedWebhooks,
    unreconciledPayments,
  ] = await Promise.all([
    prisma.customer.count({
      where: { status: 'ACTIVE' },
    }),
    prisma.payment.count({
      where: {
        paymentDate: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
        status: 'COMPLETED',
      },
    }),
    prisma.posSale.count({
      where: { paymentStatus: 'PENDING' },
    }),
    prisma.webhookEvent.count({
      where: {
        processed: false,
        retryCount: { gte: 3 },
      },
    }),
    prisma.payment.count({
      where: {
        status: 'COMPLETED',
        reconciled: false,
      },
    }),
  ]);

  const isHealthy = failedWebhooks === 0 && unreconciledPayments < 10;

  return {
    status: isHealthy ? 'healthy' : 'warning',
    activeCustomers,
    todayPayments,
    pendingPosSales,
    failedWebhooks,
    unreconciledPayments,
    timestamp: new Date().toISOString(),
  };
}
