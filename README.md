# Kelly OS - Payments & Reconciliation System

## Overview

A comprehensive payment processing and reconciliation system for **Elegant Steel & Fabrication Kenya**, built on Next.js with TypeScript, PostgreSQL, and Prisma ORM. The system automatically captures payments from M-Pesa and Equity Eazypay, matches them to customers and invoices, and maintains real-time financial integrity across all modules.

## 🌟 Key Features

### 1. Customer & Account Management
- Unique customer codes (used as PayBill account numbers)
- Running balance tracking (debit/credit)
- Full customer statement history
- Credit limit management

### 2. Invoice & POS Integration
- Manual invoice creation
- Point-of-sale transactions
- Automatic invoice generation from POS
- Multiple payment methods (Cash, M-Pesa, Eazypay)
- Pending payment tracking

### 3. Payment Channels

#### A. M-Pesa PayBill (Daraja API)
- ✅ STK Push integration
- ✅ PayBill C2B callbacks
- ✅ Account number = customer_id or invoice_id
- ✅ Automatic payment matching
- ✅ Real-time balance updates

#### B. Equity Eazypay
- ✅ Webhook receiver
- ✅ Reference-based matching
- ✅ Automatic reconciliation
- ✅ POS sale closure

#### C. Bank Statement Reconciliation
- ✅ CSV/Excel upload
- ✅ Fuzzy matching algorithm
- ✅ Manual approval workflow
- ✅ Unmatched transaction flagging

### 4. Double-Entry Ledger
- Full accounting compliance
- Automatic posting (debit/credit)
- Chart of accounts
- Audit trail
- Balance verification

### 5. Real-Time Sync
- Customer balance updates
- Invoice status changes
- POS sale completion
- Inventory adjustment hooks
- Analytics refresh

### 6. Dashboard & Analytics
- Payment analytics
- Customer balance summaries
- Overdue invoice tracking
- Collection metrics
- Payment method breakdown
- System health monitoring

### 7. Security & Reliability
- Webhook signature verification
- Idempotency keys
- Rate limiting
- Circuit breakers
- Audit logging
- Data encryption

## 📁 Project Structure

```
elegantkellyos/
├── prisma/
│   └── schema.prisma              # Database schema
├── lib/
│   ├── payments/
│   │   ├── types.ts               # TypeScript definitions
│   │   ├── payment-processor.ts   # Core payment processing
│   │   ├── ledger-engine.ts       # Double-entry accounting
│   │   ├── statement-engine.ts    # Customer statements
│   │   ├── reconciliation-engine.ts # Bank reconciliation
│   │   ├── pos-service.ts         # POS integration
│   │   ├── analytics-service.ts   # Dashboard analytics
│   │   └── security.ts            # Security utilities
│   └── config.ts                  # Environment configuration
├── app/
│   └── api/
│       ├── webhooks/
│       │   ├── mpesa/
│       │   │   ├── stkpush/route.ts   # M-Pesa STK callback
│       │   │   └── c2b/route.ts       # M-Pesa PayBill callback
│       │   └── eazypay/route.ts       # Eazypay webhook
│       └── dashboard/
│           └── analytics/route.ts     # Dashboard API
└── .env.example                   # Environment variables template
```

## 🚀 Setup Instructions

### 1. Prerequisites
- Node.js 18+
- PostgreSQL 14+
- M-Pesa Daraja API credentials
- Equity Eazypay credentials

### 2. Installation

```bash
# Clone repository
cd d:\elegantkellyos

# Install dependencies
npm install

# Install additional packages
npm install @prisma/client bcrypt jsonwebtoken
npm install -D prisma @types/node typescript
```

### 3. Database Setup

```bash
# Copy environment variables
cp .env.example .env

# Edit .env with your credentials

# Generate Prisma client
npx prisma generate

# Create database tables
npx prisma db push

# (Optional) Seed database
npx prisma db seed
```

### 4. Initialize Chart of Accounts

Create a script to initialize your accounting structure:

```typescript
// scripts/init-accounts.ts
import { PrismaClient } from '@prisma/client';
import { initializeChartOfAccounts } from '../lib/payments/ledger-engine';

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction(async (tx) => {
    await initializeChartOfAccounts(tx);
  });
  console.log('Chart of accounts initialized');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

Run it:
```bash
npx tsx scripts/init-accounts.ts
```

### 5. Configure Webhooks

#### M-Pesa Daraja
1. Log in to [Safaricom Developer Portal](https://developer.safaricom.co.ke)
2. Register your callbacks:
   - STK Push: `https://yourdomain.com/api/webhooks/mpesa/stkpush`
   - C2B: `https://yourdomain.com/api/webhooks/mpesa/c2b`

#### Equity Eazypay
1. Contact Equity Bank to register webhook
2. URL: `https://yourdomain.com/api/webhooks/eazypay`

### 6. Start Development Server

```bash
npm run dev
```

## 🔧 Usage Examples

### Create Customer

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const customer = await prisma.customer.create({
  data: {
    customerCode: 'CUST001',
    name: 'John Kamau',
    phone: '0712345678',
    email: 'john@example.com',
    balance: 0,
    creditLimit: 100000,
    branch: 'NAIROBI',
    category: 'RETAIL',
  },
});
```

### Create POS Sale

```typescript
import { createPosSale } from '@/lib/payments/pos-service';

const result = await createPosSale({
  customerId: 'customer_id',
  items: [
    {
      description: 'Steel Bars 10mm',
      quantity: 50,
      unitPrice: 800,
    },
  ],
  paymentMethod: 'MPESA',
  branch: 'NAIROBI',
  terminal: 'POS-01',
  cashier: 'user_id',
});
```

### Process Manual Payment

```typescript
import { processPayment } from '@/lib/payments/payment-processor';

const result = await processPayment({
  customerId: 'customer_id',
  amount: 50000,
  paymentMethod: 'BANK_TRANSFER',
  source: 'BANK_TRANSFER',
  reference: 'TXN123456',
  branch: 'NAIROBI',
});
```

### Upload Bank Statement

```typescript
import { processBankStatement, parseBankStatementCSV } from '@/lib/payments/reconciliation-engine';

const csvContent = await fs.readFile('statement.csv', 'utf-8');
const transactions = parseBankStatementCSV(csvContent);

const result = await processBankStatement(
  'Equity Bank',
  '1234567890',
  new Date(),
  'statement.csv',
  'user_id',
  transactions
);
```

## 🌐 API Endpoints

### Webhooks
- `POST /api/webhooks/mpesa/stkpush` - M-Pesa STK Push callback
- `POST /api/webhooks/mpesa/c2b` - M-Pesa PayBill callback
- `POST /api/webhooks/eazypay` - Equity Eazypay webhook

### Dashboard
- `GET /api/dashboard/analytics?startDate=2024-01-01&endDate=2024-12-31&branch=NAIROBI`

## 🧪 Testing

### Test M-Pesa Webhook (Development)

```bash
curl -X POST http://localhost:3000/api/webhooks/mpesa/stkpush \
  -H "Content-Type: application/json" \
  -d '{
    "Body": {
      "stkCallback": {
        "MerchantRequestID": "test-123",
        "CheckoutRequestID": "ws_CO_123",
        "ResultCode": 0,
        "ResultDesc": "Success",
        "CallbackMetadata": {
          "Item": [
            {"Name": "Amount", "Value": 1000},
            {"Name": "MpesaReceiptNumber", "Value": "TEST123"},
            {"Name": "PhoneNumber", "Value": "254712345678"}
          ]
        }
      }
    }
  }'
```

## 📊 Database Schema

### Core Tables
- `Customer` - Customer accounts with running balances
- `Invoice` - Sales invoices
- `Payment` - Payment records
- `PaymentAllocation` - Payment-to-invoice matching
- `PosSale` - Point-of-sale transactions
- `LedgerEntry` - Double-entry ledger
- `Account` - Chart of accounts
- `CustomerStatement` - Transaction history
- `WebhookEvent` - Webhook processing log
- `BankStatement` - Bank statement uploads
- `BankTransaction` - Bank transaction matching
- `AuditLog` - Audit trail

## 🔐 Security Features

### Webhook Verification
All webhooks verify signatures using HMAC-SHA256:
```typescript
const isValid = verifyWebhookSignature(payload, signature, secret);
```

### Idempotency
Prevents duplicate processing:
```typescript
const idempotencyKey = `mpesa-${transactionId}`;
const existing = await checkIdempotency(idempotencyKey);
```

### Rate Limiting
Protects against abuse:
```typescript
const { allowed } = checkRateLimit(ipAddress, 100, 60000);
```

### Circuit Breakers
Prevents cascading failures:
```typescript
const result = await mpesaCircuitBreaker.execute(async () => {
  return await callMpesaAPI();
});
```

## 🎯 Kenyan Payment Flows

### M-Pesa PayBill Flow
1. Customer pays to PayBill number
2. Uses account number = customer code or invoice number
3. Safaricom sends webhook to `/api/webhooks/mpesa/c2b`
4. System matches customer/invoice
5. Creates payment record
6. Allocates to invoices (FIFO)
7. Updates customer balance
8. Posts to ledger
9. Updates statement

### Equity Eazypay Flow
1. Customer pays via Eazypay
2. Uses reference = customer code or invoice number
3. Equity sends webhook to `/api/webhooks/eazypay`
4. System verifies signature
5. Matches by reference
6. Processes payment
7. Closes POS sale if pending

## 📈 Analytics & Reports

### Available Metrics
- Daily collections
- Payment method breakdown
- Customer balances
- Overdue invoices
- Collection efficiency
- Reconciliation status
- System health

### Access Dashboard
```typescript
const analytics = await fetch(
  '/api/dashboard/analytics?startDate=2024-01-01&endDate=2024-12-31'
);
```

## 🐛 Troubleshooting

### Common Issues

#### 1. Webhook Not Received
- Check firewall rules
- Verify callback URLs in provider portals
- Check webhook signature secrets
- Review logs: `prisma.webhookEvent.findMany()`

#### 2. Payment Not Matching
- Verify customer phone number format
- Check customer code in PayBill account
- Review fuzzy matching scores
- Use manual reconciliation

#### 3. Balance Mismatch
- Run ledger balance verification
- Check for duplicate transactions (idempotency)
- Review audit logs
- Reconcile with bank statement

## 📝 Next Steps

1. **Add Email Notifications**
   - Payment confirmations
   - Overdue invoice reminders
   - Reconciliation alerts

2. **SMS Integration**
   - Payment receipts via Africa's Talking
   - Balance inquiries

3. **Mobile App**
   - Customer portal
   - Payment history
   - Invoice viewing

4. **Advanced Analytics**
   - Predictive analytics
   - Customer segmentation
   - Cash flow forecasting

5. **Multi-Currency Support**
   - USD, EUR support
   - Exchange rate management

## 📞 Support

For Kenyan payment integration support:
- M-Pesa: https://developer.safaricom.co.ke/support
- Equity Bank: Contact your relationship manager

## 📄 License

Proprietary - Elegant Steel & Fabrication Kenya

---

**Built with ❤️ for Kenyan businesses by Kelly OS Team**
