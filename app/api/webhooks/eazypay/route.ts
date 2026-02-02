/**
 * Kelly OS - Equity Eazypay Webhook Handler
 * Receives payment notifications from Equity Bank Eazypay
 * Route: POST /api/webhooks/eazypay
 */

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient, PaymentMethod, PaymentSource, WebhookProvider } from '@prisma/client';
import { EazypayWebhookPayload } from '@/lib/payments/types';
import { processPayment } from '@/lib/payments/payment-processor';
import crypto from 'crypto';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get('x-eazypay-signature') || '';

    // Verify signature (critical for security)
    if (!verifyEazypaySignature(rawBody, signature)) {
      console.error('Invalid Eazypay signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload: EazypayWebhookPayload = JSON.parse(rawBody);
    
    console.log('Eazypay webhook received:', JSON.stringify(payload, null, 2));

    const {
      transactionId,
      reference,
      amount,
      currency,
      status,
      customerName,
      customerPhone,
      timestamp,
      merchantRef,
    } = payload;

    // Only process successful payments
    if (status !== 'SUCCESS' && status !== 'COMPLETED') {
      console.log('Payment not successful:', status);
      return NextResponse.json({ 
        message: 'Payment not successful',
        status 
      });
    }

    // Generate idempotency key to prevent duplicate processing
    const idempotencyKey = `eazypay-${transactionId}`;

    // Check if already processed
    const existing = await prisma.webhookEvent.findUnique({
      where: { idempotencyKey },
    });

    if (existing && existing.processed) {
      console.log('Webhook already processed:', idempotencyKey);
      return NextResponse.json({ 
        message: 'Already processed',
        paymentId: existing.paymentId 
      });
    }

    // Create or update webhook event
    const webhookEvent = await prisma.webhookEvent.upsert({
      where: { idempotencyKey },
      create: {
        provider: WebhookProvider.EAZYPAY,
        eventType: 'PAYMENT_RECEIVED',
        transactionId,
        payload: payload as any,
        signature,
        idempotencyKey,
      },
      update: {
        payload: payload as any,
        signature,
        retryCount: { increment: 1 },
      },
    });

    // Match customer by reference (customer code or invoice number)
    let customerId: string | null = null;
    let invoiceId: string | null = null;

    // Try as customer code first
    const customerByCode = await prisma.customer.findUnique({
      where: { customerCode: reference },
    });

    if (customerByCode) {
      customerId = customerByCode.id;
    } else {
      // Try as invoice number
      const invoice = await prisma.invoice.findUnique({
        where: { invoiceNumber: reference },
        include: { customer: true },
      });

      if (invoice) {
        customerId = invoice.customerId;
        invoiceId = invoice.id;
      } else if (merchantRef) {
        // Try merchantRef as customer code
        const customerByMerchantRef = await prisma.customer.findUnique({
          where: { customerCode: merchantRef },
        });
        
        if (customerByMerchantRef) {
          customerId = customerByMerchantRef.id;
        }
      }
      
      // Last resort: try by phone number
      if (!customerId && customerPhone) {
        const customerByPhone = await findCustomerByPhone(customerPhone);
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
        error: 'Customer not identified',
        reference,
        merchantRef 
      }, { status: 400 });
    }

    // Process payment
    const allocations = invoiceId ? [{ invoiceId, amount }] : undefined;

    const result = await processPayment({
      customerId,
      amount,
      paymentMethod: PaymentMethod.EAZYPAY,
      paymentDate: timestamp ? new Date(timestamp) : new Date(),
      transactionId,
      reference,
      source: PaymentSource.EAZYPAY,
      sourceDetails: payload,
      receiptNumber: transactionId,
      notes: customerName ? `Paid by ${customerName} via Equity Eazypay` : 'Equity Eazypay payment',
    }, allocations);

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
      await updatePosSaleFromEazypay(transactionId, customerId);

      return NextResponse.json({
        success: true,
        message: 'Payment processed successfully',
        paymentId: result.paymentId,
        paymentNumber: result.paymentNumber,
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
        success: false,
        error: result.error 
      }, { status: 500 });
    }

  } catch (error) {
    console.error('Eazypay webhook error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * Verify Eazypay webhook signature
 * CRITICAL: Always verify webhooks to prevent fraud
 */
function verifyEazypaySignature(payload: string, signature: string): boolean {
  // Get secret from environment
  const secret = process.env.EAZYPAY_WEBHOOK_SECRET;
  
  if (!secret) {
    console.error('EAZYPAY_WEBHOOK_SECRET not configured');
    // In production, return false. For dev, you might allow it.
    return process.env.NODE_ENV === 'development';
  }

  // Calculate expected signature using HMAC-SHA256
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Helper: Find customer by phone number
 */
async function findCustomerByPhone(phone: string) {
  // Clean phone number (remove country code if present)
  const cleanPhone = phone.replace(/^254/, '0').replace(/^\+254/, '0');
  
  return await prisma.customer.findFirst({
    where: {
      OR: [
        { phone: cleanPhone },
        { phone: phone },
        { phone: `254${cleanPhone.substring(1)}` },
        { phone: `+254${cleanPhone.substring(1)}` },
      ],
    },
  });
}

/**
 * Helper: Update POS sale when Eazypay payment is received
 */
async function updatePosSaleFromEazypay(transactionRef: string, customerId: string) {
  // Find pending POS sale
  const posSale = await prisma.posSale.findFirst({
    where: {
      customerId,
      paymentMethod: PaymentMethod.EAZYPAY,
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
 * Webhook validation endpoint
 * Some payment providers send a test webhook on registration
 */
export async function GET(request: NextRequest) {
  const challenge = request.nextUrl.searchParams.get('challenge');
  
  if (challenge) {
    // Respond to challenge for webhook validation
    return NextResponse.json({ challenge });
  }
  
  return NextResponse.json({ 
    status: 'Eazypay webhook endpoint active',
    timestamp: new Date().toISOString() 
  });
}
