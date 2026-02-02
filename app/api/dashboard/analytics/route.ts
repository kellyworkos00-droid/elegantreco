/**
 * Kelly OS - Dashboard API Routes
 * GET /api/dashboard/analytics
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getPaymentAnalytics,
  getCustomerBalances,
  getOverdueInvoices,
  getReconciliationStatus,
  getInvoiceStatusBreakdown,
  getCollectionMetrics,
  getSystemHealth,
} from '@/lib/payments/analytics-service';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const branch = searchParams.get('branch') || undefined;
    const startDate = searchParams.get('startDate') 
      ? new Date(searchParams.get('startDate')!) 
      : new Date(new Date().setDate(new Date().getDate() - 30));
    const endDate = searchParams.get('endDate') 
      ? new Date(searchParams.get('endDate')!) 
      : new Date();

    // Fetch all dashboard data in parallel
    const [
      paymentAnalytics,
      customerBalances,
      overdueInvoices,
      reconciliationStatus,
      invoiceBreakdown,
      collectionMetrics,
      systemHealth,
    ] = await Promise.all([
      getPaymentAnalytics(startDate, endDate, branch),
      getCustomerBalances(branch),
      getOverdueInvoices(branch),
      getReconciliationStatus(branch),
      getInvoiceStatusBreakdown(branch),
      getCollectionMetrics(startDate, endDate, branch),
      getSystemHealth(),
    ]);

    return NextResponse.json({
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      branch: branch || 'ALL',
      paymentAnalytics,
      customerBalances: customerBalances.slice(0, 20), // Top 20
      overdueInvoices: {
        ...overdueInvoices,
        invoices: overdueInvoices.invoices.slice(0, 50), // Limit response size
      },
      reconciliationStatus,
      invoiceBreakdown,
      collectionMetrics,
      systemHealth,
    });
  } catch (error) {
    console.error('Dashboard API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}
