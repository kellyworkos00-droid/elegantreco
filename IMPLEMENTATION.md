# Kelly OS Payments - Implementation Guide

## 🚦 Step-by-Step Implementation

### Phase 1: Database & Core Setup (Day 1)

#### 1.1 Initialize Project
```bash
cd d:\elegantkellyos
npm install
```

#### 1.2 Configure Environment
```bash
cp .env.example .env
# Edit .env with your database and API credentials
```

#### 1.3 Setup Database
```bash
# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# Initialize chart of accounts
npm run init:accounts

# Seed sample data
npm run db:seed

# Open Prisma Studio to verify
npm run db:studio
```

### Phase 2: M-Pesa Integration (Day 2-3)

#### 2.1 Register with Safaricom Daraja
1. Go to https://developer.safaricom.co.ke
2. Create an app
3. Note down:
   - Consumer Key
   - Consumer Secret
   - Passkey
   - Shortcode
4. Register callback URLs:
   - `https://yourdomain.com/api/webhooks/mpesa/stkpush`
   - `https://yourdomain.com/api/webhooks/mpesa/c2b`

#### 2.2 Test M-Pesa Integration
```bash
# Start dev server
npm run dev

# Test STK Push callback (in another terminal)
curl -X POST http://localhost:3000/api/webhooks/mpesa/stkpush \
  -H "Content-Type: application/json" \
  -d @test-data/mpesa-callback.json
```

#### 2.3 Go Live
1. Switch to production credentials
2. Update MPESA_ENVIRONMENT=production in .env
3. Deploy to production
4. Test with real transactions (small amounts)

### Phase 3: Equity Eazypay Integration (Day 4)

#### 3.1 Setup Eazypay
1. Contact Equity Bank relationship manager
2. Request Eazypay merchant account
3. Provide webhook URL: `https://yourdomain.com/api/webhooks/eazypay`
4. Receive credentials:
   - Merchant ID
   - API Key
   - API Secret
   - Webhook Secret

#### 3.2 Test Eazypay
```bash
# Test webhook
curl -X POST http://localhost:3000/api/webhooks/eazypay \
  -H "Content-Type: application/json" \
  -H "x-eazypay-signature: your_signature" \
  -d @test-data/eazypay-callback.json
```

### Phase 4: POS Integration (Day 5-6)

#### 4.1 Create POS Sale Function
```typescript
// In your POS component
import { createPosSale } from '@/lib/payments/pos-service';

async function handleSale() {
  const result = await createPosSale({
    customerId: selectedCustomer.id,
    items: cartItems.map(item => ({
      description: item.name,
      quantity: item.qty,
      unitPrice: item.price,
    })),
    paymentMethod: paymentMethod, // CASH, MPESA, EAZYPAY
    branch: currentBranch,
    terminal: terminalId,
    cashier: currentUser.id,
  });

  if (result.success) {
    // Show success message
    // Print receipt
    // Clear cart
  }
}
```

#### 4.2 Monitor Pending Sales
```typescript
// Dashboard component
import { getPendingPosSales } from '@/lib/payments/pos-service';

const pendingSales = await getPendingPosSales('NAIROBI');
// Display waiting for payment confirmation
```

### Phase 5: Bank Reconciliation (Day 7)

#### 5.1 Create Upload Interface
```typescript
// Bank statement upload component
import { processBankStatement, parseBankStatementCSV } from '@/lib/payments/reconciliation-engine';

async function handleFileUpload(file: File) {
  const content = await file.text();
  const transactions = parseBankStatementCSV(content);
  
  const result = await processBankStatement(
    'Equity Bank',
    '1234567890',
    new Date(),
    file.name,
    currentUser.id,
    transactions
  );
  
  console.log(`Auto-matched: ${result.autoMatched}`);
  console.log(`Need review: ${result.unmatchedCount}`);
}
```

#### 5.2 Manual Reconciliation UI
```typescript
import { getSuggestedMatches, approveMatch } from '@/lib/payments/reconciliation-engine';

// Get suggestions
const matches = await getSuggestedMatches(transactionId);

// User selects best match and approves
await approveMatch(transactionId, selectedPaymentId, currentUser.id);
```

### Phase 6: Dashboard & Reports (Day 8)

#### 6.1 Implement Dashboard
```typescript
// Dashboard page
import { getPaymentAnalytics, getCustomerBalances } from '@/lib/payments/analytics-service';

export default async function DashboardPage() {
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = new Date();
  
  const analytics = await getPaymentAnalytics(startDate, endDate);
  const balances = await getCustomerBalances();
  
  return (
    <div>
      <h1>Payments Dashboard</h1>
      <div>Total Collected: KES {analytics.totalCollected.toLocaleString()}</div>
      <div>Total Pending: KES {analytics.totalPending.toLocaleString()}</div>
      {/* More dashboard components */}
    </div>
  );
}
```

#### 6.2 Use Dashboard API
```typescript
// Client component
const response = await fetch('/api/dashboard/analytics?startDate=2024-01-01&endDate=2024-12-31');
const data = await response.json();
```

### Phase 7: Security & Monitoring (Day 9)

#### 7.1 Setup Webhook Retry Job
```bash
# Add to crontab (run every 5 minutes)
*/5 * * * * cd /path/to/project && npm run retry:webhooks
```

#### 7.2 Monitor System Health
```typescript
import { getSystemHealth } from '@/lib/payments/analytics-service';

const health = await getSystemHealth();
if (health.status !== 'healthy') {
  // Send alert to admin
  sendAlert(`System health warning: ${health.failedWebhooks} failed webhooks`);
}
```

#### 7.3 Setup Audit Log Review
```typescript
// Admin dashboard
const auditLogs = await prisma.auditLog.findMany({
  where: {
    timestamp: {
      gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  },
  orderBy: {
    timestamp: 'desc',
  },
  take: 100,
});
```

## 🧪 Testing Checklist

### Unit Tests
- [ ] Payment processing
- [ ] Invoice allocation (FIFO)
- [ ] Ledger posting
- [ ] Balance calculations
- [ ] Customer statement updates

### Integration Tests
- [ ] M-Pesa STK Push callback
- [ ] M-Pesa C2B PayBill callback
- [ ] Eazypay webhook
- [ ] Bank statement upload
- [ ] POS sale creation
- [ ] Manual reconciliation

### End-to-End Tests
- [ ] Customer makes M-Pesa payment → Balance updates
- [ ] POS sale with M-Pesa → Auto-closes on callback
- [ ] Upload bank statement → Auto-match → Manual approve
- [ ] Create invoice → Receive payment → Close invoice
- [ ] Payment reversal → Balance restored

## 🔍 Monitoring & Alerts

### Key Metrics to Monitor
1. **Payment Processing**
   - Average processing time
   - Success rate
   - Failed transactions

2. **Reconciliation**
   - Reconciliation rate
   - Unmatched transactions
   - Manual intervention rate

3. **System Health**
   - Webhook processing rate
   - Failed webhooks
   - Database performance

### Alert Thresholds
- Failed webhooks > 10 → Critical
- Unreconciled payments > 100 → Warning
- System response time > 5s → Warning

## 🐛 Common Issues & Solutions

### Issue 1: Payment Not Matching Customer
**Symptoms:** Payment received but customer not found

**Solutions:**
1. Check phone number format in database
2. Verify customer code matches PayBill account
3. Check webhook payload for correct data
4. Use manual reconciliation

**Prevention:**
- Standardize phone number format (0712345678)
- Train customers on correct account numbers
- Display clear instructions at POS

### Issue 2: Duplicate Payments
**Symptoms:** Same payment processed twice

**Solutions:**
1. Check idempotency keys are working
2. Review webhook event log
3. Use reversal function if needed

**Prevention:**
- Always use idempotency keys
- Check existing transactions before processing

### Issue 3: Balance Mismatch
**Symptoms:** Customer balance doesn't match statement

**Solutions:**
1. Run balance verification query:
```sql
SELECT 
  c.id,
  c.name,
  c.balance AS customer_balance,
  COALESCE(SUM(i.balance), 0) AS invoice_balance
FROM Customer c
LEFT JOIN Invoice i ON i.customerId = c.id AND i.status != 'CANCELLED'
GROUP BY c.id
HAVING c.balance != COALESCE(SUM(i.balance), 0);
```

2. Check for missing transactions
3. Review audit log

**Prevention:**
- Use database transactions for all operations
- Never update balances manually
- Regular reconciliation

### Issue 4: Webhook Signature Verification Fails
**Symptoms:** All webhooks rejected with 401

**Solutions:**
1. Verify secret in .env matches provider
2. Check signature algorithm (HMAC-SHA256)
3. Ensure raw body is used (not parsed JSON)

**Prevention:**
- Store secrets securely
- Document signature algorithm
- Test in sandbox first

## 📊 Performance Optimization

### Database Indexes
Already included in schema:
- Customer: customerCode, phone, status
- Invoice: invoiceNumber, customerId, status, dueDate
- Payment: transactionId, customerId, paymentDate, reconciled
- LedgerEntry: entryNumber, postDate, customerId

### Query Optimization
```typescript
// Good: Use select to limit fields
const customers = await prisma.customer.findMany({
  select: {
    id: true,
    name: true,
    balance: true,
  },
});

// Good: Use pagination
const invoices = await prisma.invoice.findMany({
  take: 50,
  skip: page * 50,
});

// Bad: Don't fetch all records
const all = await prisma.payment.findMany(); // Avoid in production
```

### Caching Strategy
```typescript
// Cache dashboard data (5 minutes)
import { Redis } from 'ioredis';

const redis = new Redis();

async function getCachedAnalytics() {
  const cached = await redis.get('dashboard:analytics');
  if (cached) return JSON.parse(cached);
  
  const fresh = await getPaymentAnalytics(startDate, endDate);
  await redis.setex('dashboard:analytics', 300, JSON.stringify(fresh));
  return fresh;
}
```

## 🚀 Deployment

### Production Checklist
- [ ] Environment variables configured
- [ ] Database backed up
- [ ] SSL certificate installed
- [ ] Webhook URLs registered with providers
- [ ] Secrets rotated from sandbox
- [ ] Monitoring setup
- [ ] Backup strategy in place
- [ ] Load testing completed
- [ ] Security audit done
- [ ] Team trained

### Deployment Commands
```bash
# Build production
npm run build

# Start production
npm start

# Or use PM2
pm2 start npm --name "kellyos" -- start
pm2 save
pm2 startup
```

### Database Backup
```bash
# Backup
pg_dump kellyos > backup_$(date +%Y%m%d).sql

# Restore
psql kellyos < backup_20240101.sql
```

## 📞 Support Contacts

### Technical Support
- M-Pesa Daraja: daraja@safaricom.co.ke
- Equity Eazypay: Your relationship manager

### System Administrators
- Monitor webhook logs daily
- Review reconciliation reports weekly
- Backup database daily
- Update security certificates monthly

## 🎓 Training Materials

### For Cashiers
1. How to create POS sales
2. Selecting payment methods
3. Waiting for M-Pesa confirmation
4. Handling failed payments

### For Accountants
1. Reviewing daily collections
2. Bank statement reconciliation
3. Manual payment matching
4. Generating reports

### For Administrators
1. System monitoring
2. Webhook management
3. Customer account management
4. Security best practices

---

**Remember: This is a bank-grade system. Every transaction matters. Test thoroughly before production deployment.**

🎯 **Target: 99.9% payment matching accuracy**
⚡ **Goal: Real-time balance updates within 2 seconds**
🔒 **Standard: Zero tolerance for duplicate payments**
