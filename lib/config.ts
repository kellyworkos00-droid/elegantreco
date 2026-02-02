/**
 * Kelly OS - Environment Configuration
 * Store all environment variables with proper typing
 */

export const config = {
  // Database
  database: {
    url: process.env.DATABASE_URL!,
  },

  // M-Pesa Daraja API
  mpesa: {
    consumerKey: process.env.MPESA_CONSUMER_KEY!,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET!,
    passkey: process.env.MPESA_PASSKEY!,
    shortCode: process.env.MPESA_SHORTCODE!,
    paybillNumber: process.env.MPESA_PAYBILL_NUMBER!,
    webhookSecret: process.env.MPESA_WEBHOOK_SECRET!,
    callbackUrl: process.env.MPESA_CALLBACK_URL || 'https://yourdomain.com/api/webhooks/mpesa',
    environment: process.env.MPESA_ENVIRONMENT || 'sandbox', // sandbox or production
  },

  // Equity Eazypay
  eazypay: {
    merchantId: process.env.EAZYPAY_MERCHANT_ID!,
    apiKey: process.env.EAZYPAY_API_KEY!,
    apiSecret: process.env.EAZYPAY_API_SECRET!,
    webhookSecret: process.env.EAZYPAY_WEBHOOK_SECRET!,
    webhookUrl: process.env.EAZYPAY_WEBHOOK_URL || 'https://yourdomain.com/api/webhooks/eazypay',
    environment: process.env.EAZYPAY_ENVIRONMENT || 'sandbox',
  },

  // Security
  security: {
    encryptionKey: process.env.ENCRYPTION_KEY!,
    jwtSecret: process.env.JWT_SECRET!,
  },

  // Application
  app: {
    name: 'Kelly OS',
    environment: process.env.NODE_ENV || 'development',
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  },
};

/**
 * Validate required environment variables
 */
export function validateConfig() {
  const required = [
    'DATABASE_URL',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_PASSKEY',
    'MPESA_SHORTCODE',
    'EAZYPAY_MERCHANT_ID',
    'EAZYPAY_API_KEY',
    'EAZYPAY_API_SECRET',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file.'
    );
  }
}
