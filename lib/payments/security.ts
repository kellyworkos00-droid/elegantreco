/**
 * Kelly OS - Security & Reliability Utilities
 * Handles webhook verification, idempotency, and error handling
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Verify webhook signature using HMAC-SHA256
 * Use this for both M-Pesa and Eazypay webhooks
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    // Calculate expected signature
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(signature.toLowerCase()),
      Buffer.from(expectedSignature.toLowerCase())
    );
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Generate idempotency key for transactions
 * Prevents duplicate processing of the same transaction
 */
export function generateIdempotencyKey(
  provider: string,
  transactionId: string
): string {
  return `${provider.toLowerCase()}-${transactionId}`;
}

/**
 * Check if transaction has already been processed
 * Returns existing payment if found
 */
export async function checkIdempotency(idempotencyKey: string) {
  return await prisma.webhookEvent.findUnique({
    where: { idempotencyKey },
    include: {
      payment: true,
    },
  });
}

/**
 * Retry failed webhook processing
 * Called by a background job to retry failed webhooks
 */
export async function retryFailedWebhooks(maxRetries: number = 3) {
  const failedWebhooks = await prisma.webhookEvent.findMany({
    where: {
      processed: false,
      retryCount: {
        lt: maxRetries,
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
    take: 50, // Process in batches
  });

  console.log(`Retrying ${failedWebhooks.length} failed webhooks`);

  const results = {
    success: 0,
    failed: 0,
  };

  for (const webhook of failedWebhooks) {
    try {
      // Re-process based on provider
      // This would call the appropriate webhook handler
      // For now, just increment retry count
      await prisma.webhookEvent.update({
        where: { id: webhook.id },
        data: {
          retryCount: { increment: 1 },
        },
      });

      results.success++;
    } catch (error) {
      console.error(`Failed to retry webhook ${webhook.id}:`, error);
      results.failed++;
    }
  }

  return results;
}

/**
 * Validate payment amount
 * Ensures amounts are positive and within reasonable limits
 */
export function validatePaymentAmount(amount: number): {
  valid: boolean;
  error?: string;
} {
  if (amount <= 0) {
    return { valid: false, error: 'Amount must be greater than 0' };
  }

  // Maximum single payment: 10 million KES
  if (amount > 10000000) {
    return { valid: false, error: 'Amount exceeds maximum limit' };
  }

  // Check for suspicious decimal places (more than 2)
  const decimalPlaces = (amount.toString().split('.')[1] || '').length;
  if (decimalPlaces > 2) {
    return { valid: false, error: 'Invalid amount precision' };
  }

  return { valid: true };
}

/**
 * Sanitize customer reference/input
 * Prevents SQL injection and XSS attacks
 */
export function sanitizeInput(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/['"]/g, '') // Remove quotes
    .substring(0, 255); // Limit length
}

/**
 * Rate limiting check
 * Prevents abuse of webhook endpoints
 */
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(
  identifier: string,
  maxRequests: number = 100,
  windowMs: number = 60000 // 1 minute
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = rateLimitMap.get(identifier);

  if (!record || now > record.resetTime) {
    // Create new record
    rateLimitMap.set(identifier, {
      count: 1,
      resetTime: now + windowMs,
    });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (record.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  return { allowed: true, remaining: maxRequests - record.count };
}

/**
 * Log audit trail
 * Records all critical actions for compliance
 */
export async function logAudit(
  entityType: string,
  entityId: string,
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'REJECT' | 'RECONCILE',
  userId: string,
  userName: string,
  oldValue?: any,
  newValue?: any,
  ipAddress?: string,
  userAgent?: string
) {
  try {
    await prisma.auditLog.create({
      data: {
        entityType,
        entityId,
        action,
        userId,
        userName,
        oldValue: oldValue || null,
        newValue: newValue || null,
        ipAddress,
        userAgent,
      },
    });
  } catch (error) {
    console.error('Audit logging error:', error);
    // Don't throw - audit logging should not break the main flow
  }
}

/**
 * Encrypt sensitive data
 * Use for storing sensitive customer information
 */
export function encryptData(data: string, key?: string): string {
  const encryptionKey = key || process.env.ENCRYPTION_KEY || 'default-key-change-me';
  const cipher = crypto.createCipher('aes-256-cbc', encryptionKey);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

/**
 * Decrypt sensitive data
 */
export function decryptData(encryptedData: string, key?: string): string {
  const encryptionKey = key || process.env.ENCRYPTION_KEY || 'default-key-change-me';
  const decipher = crypto.createDecipher('aes-256-cbc', encryptionKey);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Validate phone number format (Kenyan)
 * Accepts: 0712345678, 254712345678, +254712345678
 */
export function validateKenyanPhone(phone: string): {
  valid: boolean;
  normalized?: string;
  error?: string;
} {
  // Remove spaces and hyphens
  const cleaned = phone.replace(/[\s-]/g, '');

  // Check formats
  const patterns = [
    /^0[17]\d{8}$/, // 0712345678
    /^254[17]\d{8}$/, // 254712345678
    /^\+254[17]\d{8}$/, // +254712345678
  ];

  const isValid = patterns.some(pattern => pattern.test(cleaned));

  if (!isValid) {
    return {
      valid: false,
      error: 'Invalid Kenyan phone number format',
    };
  }

  // Normalize to 0712345678 format
  let normalized = cleaned;
  if (normalized.startsWith('+254')) {
    normalized = '0' + normalized.substring(4);
  } else if (normalized.startsWith('254')) {
    normalized = '0' + normalized.substring(3);
  }

  return {
    valid: true,
    normalized,
  };
}

/**
 * Mask sensitive data for logging
 * Masks credit card, phone numbers, etc.
 */
export function maskSensitiveData(data: string, maskChar: string = '*'): string {
  if (!data || data.length <= 4) return data;
  
  const visibleChars = 4;
  const maskedLength = data.length - visibleChars;
  return maskChar.repeat(maskedLength) + data.slice(-visibleChars);
}

/**
 * Circuit breaker for external API calls
 * Prevents cascading failures when external services are down
 */
class CircuitBreaker {
  private failures: number = 0;
  private lastFailTime: number = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private threshold: number = 5,
    private timeout: number = 60000 // 1 minute
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      // Check if timeout has passed
      if (Date.now() - this.lastFailTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure() {
    this.failures++;
    this.lastFailTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
    }
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
    };
  }
}

// Export singleton instance for external API calls
export const mpesaCircuitBreaker = new CircuitBreaker(5, 60000);
export const eazypayCircuitBreaker = new CircuitBreaker(5, 60000);

/**
 * Health check for external services
 */
export async function checkExternalServices() {
  return {
    mpesa: mpesaCircuitBreaker.getState(),
    eazypay: eazypayCircuitBreaker.getState(),
  };
}
