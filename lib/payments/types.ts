/**
 * Kelly OS - Payments & Reconciliation System
 * Type definitions for payment processing
 */

import { PaymentMethod, PaymentSource, PaymentStatus } from '@prisma/client';

// ============================================
// PAYMENT TYPES
// ============================================

export interface CreatePaymentInput {
  customerId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentDate?: Date;
  transactionId?: string;
  reference?: string;
  source: PaymentSource;
  sourceDetails?: any;
  branch?: string;
  notes?: string;
  receiptNumber?: string;
}

export interface AllocatePaymentInput {
  paymentId: string;
  invoiceId: string;
  amount: number;
}

export interface PaymentResult {
  success: boolean;
  paymentId?: string;
  paymentNumber?: string;
  message?: string;
  error?: string;
}

// ============================================
// WEBHOOK TYPES
// ============================================

export interface MPesaCallbackPayload {
  Body: {
    stkCallback?: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{
          Name: string;
          Value: any;
        }>;
      };
    };
  };
}

export interface MPesaC2BPayload {
  TransactionType: string;
  TransID: string;
  TransTime: string;
  TransAmount: string;
  BusinessShortCode: string;
  BillRefNumber: string;
  InvoiceNumber?: string;
  OrgAccountBalance?: string;
  ThirdPartyTransID?: string;
  MSISDN: string;
  FirstName?: string;
  MiddleName?: string;
  LastName?: string;
}

export interface EazypayWebhookPayload {
  transactionId: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  customerName?: string;
  customerPhone?: string;
  timestamp: string;
  merchantRef?: string;
}

export interface WebhookProcessResult {
  success: boolean;
  paymentId?: string;
  transactionId?: string;
  message?: string;
  error?: string;
}

// ============================================
// RECONCILIATION TYPES
// ============================================

export interface ReconciliationMatch {
  transactionId: string;
  paymentId?: string;
  customerId?: string;
  invoiceId?: string;
  amount: number;
  matchScore: number;
  matchType: 'exact' | 'fuzzy' | 'manual';
  confidence: 'high' | 'medium' | 'low';
}

export interface BankStatementRow {
  date: Date;
  description: string;
  reference?: string;
  debit: number;
  credit: number;
  balance: number;
}

// ============================================
// INVOICE TYPES
// ============================================

export interface CreateInvoiceInput {
  customerId: string;
  items: InvoiceItemInput[];
  dueDate?: Date;
  branch?: string;
  notes?: string;
  reference?: string;
  createdBy: string;
}

export interface InvoiceItemInput {
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  tax?: number;
  discount?: number;
}

// ============================================
// POS TYPES
// ============================================

export interface CreatePosSaleInput {
  customerId: string;
  items: PosSaleItemInput[];
  paymentMethod: PaymentMethod;
  branch: string;
  terminal?: string;
  cashier: string;
  notes?: string;
}

export interface PosSaleItemInput {
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

// ============================================
// LEDGER TYPES
// ============================================

export interface LedgerPostingInput {
  debitAccountCode: string;
  creditAccountCode: string;
  amount: number;
  description: string;
  sourceType: 'INVOICE' | 'PAYMENT' | 'SALE' | 'ADJUSTMENT' | 'OPENING_BALANCE';
  sourceId: string;
  customerId?: string;
  invoiceId?: string;
  paymentId?: string;
  reference?: string;
  branch?: string;
  postedBy: string;
}

// ============================================
// ANALYTICS TYPES
// ============================================

export interface PaymentAnalytics {
  totalCollected: number;
  totalPending: number;
  paymentsByMethod: Record<PaymentMethod, number>;
  dailyCollections: Array<{
    date: string;
    amount: number;
  }>;
  topCustomers: Array<{
    customerId: string;
    customerName: string;
    totalPaid: number;
  }>;
}

export interface CustomerBalanceSummary {
  customerId: string;
  customerName: string;
  balance: number;
  creditLimit: number;
  availableCredit: number;
  overdueAmount: number;
  currentAmount: number;
}
