/**
 * Kelly OS - M-Pesa C2B PayBill Callback
 * Route: POST /api/webhooks/mpesa/c2b
 */

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient, PaymentMethod, PaymentSource, WebhookProvider } from '@prisma/client';
import { MPesaC2BPayload } from '@/lib/payments/types';
import { processPayment } from '@/lib/payments/payment-processor';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
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
