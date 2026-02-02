/**
 * Kelly OS - M-Pesa Daraja API Integration
 * Handles STK Push and PayBill C2B callbacks for Kenyan payments
 */

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient, PaymentMethod, PaymentSource, WebhookProvider } from '@prisma/client';
import { MPesaCallbackPayload, MPesaC2BPayload, WebhookProcessResult } from '@/lib/payments/types';
import { processPayment } from '@/lib/payments/payment-processor';
import crypto from 'crypto';

const prisma = new PrismaClient();

/**
 * M-Pesa STK Push Callback Handler
 * Called by Safaricom after customer enters PIN
 * Route: POST /api/webhooks/mpesa/stkpush
 */
export async function POST(request: NextRequest) {
  try {
    const payload: MPesaCallbackPayload = await request.json();
    
    console.log('M-Pesa STK Callback received:', JSON.stringify(payload, null, 2));

    // Extract callback data
    const stkCallback = payload.Body.stkCallback;
    if (!stkCallback) {
      return NextResponse.json({ error: 'Invalid callback structure' }, { status: 400 });
    }

    const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;

    // Generate idempotency key to prevent duplicate processing
    const idempotencyKey = `mpesa-stk-${CheckoutRequestID}`;

    // Check if already processed
    const existing = await prisma.webhookEvent.findUnique({
      where: { idempotencyKey },
    });

    if (existing && existing.processed) {
      console.log('Webhook already processed:', idempotencyKey);
      return NextResponse.json({ message: 'Already processed' });
    }

    // Create or update webhook event
    const webhookEvent = await prisma.webhookEvent.upsert({
      where: { idempotencyKey },
      create: {
        provider: WebhookProvider.MPESA,
        eventType: 'STK_PUSH_CALLBACK',
        payload: payload as any,
        idempotencyKey,
        transactionId: CheckoutRequestID,
      },
      update: {
        payload: payload as any,
        retryCount: { increment: 1 },
      },
    });

    // Check if payment was successful
    if (ResultCode !== 0) {
      // Payment failed
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: true,
          processedAt: new Date(),
          error: ResultDesc,
        },
      });

      return NextResponse.json({ 
        message: 'Payment failed', 
        reason: ResultDesc 
      });
    }

    // Payment successful - extract metadata
    const metadata = parseCallbackMetadata(CallbackMetadata?.Item || []);
    const {
      Amount,
      MpesaReceiptNumber,
      TransactionDate,
      PhoneNumber,
    } = metadata;

    // Find customer by phone number or reference
    const customer = await findCustomerByPhone(PhoneNumber);
    
    if (!customer) {
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: false,
          error: 'Customer not found',
        },
      });

      return NextResponse.json({ 
        error: 'Customer not found',
        message: 'Payment received but customer could not be identified'
      }, { status: 400 });
    }

    // Process payment
    const result = await processPayment({
      customerId: customer.id,
      amount: Amount,
      paymentMethod: PaymentMethod.MPESA,
      paymentDate: TransactionDate ? new Date(TransactionDate) : new Date(),
      transactionId: MpesaReceiptNumber,
      source: PaymentSource.MPESA_STK_PUSH,
      sourceDetails: payload,
      receiptNumber: MpesaReceiptNumber,
    });

    if (result.success) {
      // Update webhook as processed
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: true,
          processedAt: new Date(),
          paymentId: result.paymentId,
        },
      });

      // Update any pending POS sale
      await updatePosSaleFromMpesa(MpesaReceiptNumber, customer.id);

      return NextResponse.json({
        ResultCode: 0,
        ResultDesc: 'Payment processed successfully',
        paymentId: result.paymentId,
      });
    } else {
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: false,
          error: result.error,
        },
      });

      return NextResponse.json({ 
        error: result.error 
      }, { status: 500 });
    }

  } catch (error) {
    console.error('M-Pesa STK callback error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * M-Pesa PayBill C2B Callback Handler
 * Called when customer pays to PayBill number
 * Route: POST /api/webhooks/mpesa/c2b
 * 
 * CRITICAL: Account number MUST be customer_id or invoice_id
 */
export async function handleC2BCallback(request: NextRequest) {
  try {
    const payload: MPesaC2BPayload = await request.json();
    
    console.log('M-Pesa C2B Callback received:', JSON.stringify(payload, null, 2));

    const {
      TransID,
      TransTime,
      TransAmount,
      BillRefNumber, // This is the account number = customer_id or invoice_id
      MSISDN,
      FirstName,
      MiddleName,
      LastName,
    } = payload;

    // Generate idempotency key
    const idempotencyKey = `mpesa-c2b-${TransID}`;

    // Check if already processed
    const existing = await prisma.webhookEvent.findUnique({
      where: { idempotencyKey },
    });

    if (existing && existing.processed) {
      console.log('Webhook already processed:', idempotencyKey);
      return NextResponse.json({ 
        ResultCode: 0,
        ResultDesc: 'Already processed' 
      });
    }

    // Create webhook event
    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        provider: WebhookProvider.MPESA,
        eventType: 'C2B_PAYMENT',
        transactionId: TransID,
        payload: payload as any,
        idempotencyKey,
      },
    });

    // Parse account number to find customer or invoice
    const amount = parseFloat(TransAmount);
    const customerName = [FirstName, MiddleName, LastName].filter(Boolean).join(' ');

    // Try to match by BillRefNumber (customer code or invoice number)
    let customerId: string | null = null;
    let invoiceId: string | null = null;

    // First try as customer code
    const customerByCode = await prisma.customer.findUnique({
      where: { customerCode: BillRefNumber },
    });

    if (customerByCode) {
      customerId = customerByCode.id;
    } else {
      // Try as invoice number
      const invoice = await prisma.invoice.findUnique({
        where: { invoiceNumber: BillRefNumber },
        include: { customer: true },
      });

      if (invoice) {
        customerId = invoice.customerId;
        invoiceId = invoice.id;
      } else {
        // Try by phone number
        const customerByPhone = await findCustomerByPhone(MSISDN);
        if (customerByPhone) {
          customerId = customerByPhone.id;
        }
      }
    }

    if (!customerId) {
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: false,
          error: 'Customer not found',
        },
      });

      return NextResponse.json({ 
        ResultCode: 1,
        ResultDesc: 'Customer not identified'
      }, { status: 400 });
    }

    // Process payment
    const allocations = invoiceId ? [{ invoiceId, amount }] : undefined;

    const result = await processPayment({
      customerId,
      amount,
      paymentMethod: PaymentMethod.MPESA,
      transactionId: TransID,
      reference: BillRefNumber,
      source: PaymentSource.MPESA_PAYBILL,
      sourceDetails: payload,
      receiptNumber: TransID,
      notes: `Paid by ${customerName} via M-Pesa PayBill`,
    }, allocations);

    if (result.success) {
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: true,
          processedAt: new Date(),
          paymentId: result.paymentId,
        },
      });

      return NextResponse.json({
        ResultCode: 0,
        ResultDesc: 'Accepted',
        paymentId: result.paymentId,
      });
    } else {
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: false,
          error: result.error,
        },
      });

      return NextResponse.json({ 
        ResultCode: 1,
        ResultDesc: result.error 
      }, { status: 500 });
    }

  } catch (error) {
    console.error('M-Pesa C2B callback error:', error);
    return NextResponse.json({ 
      ResultCode: 1,
      ResultDesc: 'Internal server error'
    }, { status: 500 });
  }
}

/**
 * Helper: Parse M-Pesa callback metadata
 */
function parseCallbackMetadata(items: Array<{ Name: string; Value: any }>) {
  const metadata: any = {};
  for (const item of items) {
    metadata[item.Name] = item.Value;
  }
  return metadata;
}

/**
 * Helper: Find customer by phone number
 */
async function findCustomerByPhone(phone: string) {
  // Clean phone number (remove country code if present)
  const cleanPhone = phone.replace(/^254/, '0');
  
  return await prisma.customer.findFirst({
    where: {
      OR: [
        { phone: cleanPhone },
        { phone: phone },
        { phone: `254${cleanPhone.substring(1)}` },
      ],
    },
  });
}

/**
 * Helper: Update POS sale when M-Pesa payment is received
 */
async function updatePosSaleFromMpesa(transactionRef: string, customerId: string) {
  // Find pending POS sale
  const posSale = await prisma.posSale.findFirst({
    where: {
      customerId,
      paymentMethod: PaymentMethod.MPESA,
      paymentStatus: 'PENDING',
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (posSale) {
    await prisma.posSale.update({
      where: { id: posSale.id },
      data: {
        paymentStatus: 'COMPLETED',
        transactionRef,
        completedAt: new Date(),
      },
    });
  }
}

/**
 * Verify M-Pesa webhook signature (if using OAuth)
 * Add this if Safaricom requires signature verification
 */
function verifyMpesaSignature(payload: string, signature: string): boolean {
  // Implement based on Safaricom's documentation
  // Usually involves HMAC-SHA256 with your app secret
  const secret = process.env.MPESA_WEBHOOK_SECRET || '';
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64');
  
  return signature === expectedSignature;
}
