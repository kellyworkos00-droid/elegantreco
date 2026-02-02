# 🚀 Kelly OS Payments - Quick Start Guide

## Get Up and Running in 10 Minutes

### Step 1: Install Dependencies (2 min)
```bash
cd d:\elegantkellyos
npm install
```

### Step 2: Setup Database (3 min)
```bash
# Copy environment file
cp .env.example .env

# Edit .env - Add your PostgreSQL connection
# DATABASE_URL="postgresql://user:password@localhost:5432/kellyos"

# Generate Prisma client
npx prisma generate

# Create database tables
npx prisma db push
```

### Step 3: Initialize System (2 min)
```bash
# Setup chart of accounts
npm run init:accounts

# Load sample data (optional)
npm run db:seed
```

### Step 4: Start Development Server (1 min)
```bash
npm run dev
```

Your server is now running at `http://localhost:3000`!

### Step 5: Test Webhook (2 min)

Open a new terminal and test M-Pesa webhook:

```bash
curl -X POST http://localhost:3000/api/webhooks/mpesa/stkpush \
  -H "Content-Type: application/json" \
  -d @test-data/mpesa-callback.json
```

✅ If you see `"ResultCode": 0`, it's working!

## Next Steps

### For Development
1. Open Prisma Studio to view data:
   ```bash
   npm run db:studio
   ```

2. Check the dashboard API:
   ```bash
   curl http://localhost:3000/api/dashboard/analytics
   ```

### For Production

1. **Get M-Pesa Credentials:**
   - Go to https://developer.safaricom.co.ke
   - Create app and get Consumer Key/Secret
   - Add to .env

2. **Get Eazypay Credentials:**
   - Contact Equity Bank
   - Request merchant account
   - Add credentials to .env

3. **Deploy:**
   ```bash
   npm run build
   npm start
   ```

4. **Register Webhooks:**
   - M-Pesa: Register `https://yourdomain.com/api/webhooks/mpesa/*`
   - Eazypay: Register `https://yourdomain.com/api/webhooks/eazypay`

## Common Commands

```bash
# Development
npm run dev                    # Start dev server
npm run db:studio             # Open Prisma Studio

# Database
npm run db:generate           # Generate Prisma client
npm run db:push              # Push schema to DB
npm run db:seed              # Seed sample data

# Production
npm run build                 # Build for production
npm start                    # Start production server

# Maintenance
npm run init:accounts        # Initialize chart of accounts
npm run retry:webhooks       # Retry failed webhooks
```

## Quick Reference

### Create Customer
```typescript
const customer = await prisma.customer.create({
  data: {
    customerCode: 'CUST001',
    name: 'John Kamau',
    phone: '0712345678',
    balance: 0,
    creditLimit: 100000,
  },
});
```

### Create POS Sale
```typescript
import { createPosSale } from '@/lib/payments/pos-service';

await createPosSale({
  customerId: 'customer_id',
  items: [{ description: 'Item', quantity: 1, unitPrice: 1000 }],
  paymentMethod: 'MPESA',
  branch: 'NAIROBI',
  terminal: 'POS-01',
  cashier: 'user_id',
});
```

### Process Payment
```typescript
import { processPayment } from '@/lib/payments/payment-processor';

await processPayment({
  customerId: 'customer_id',
  amount: 5000,
  paymentMethod: 'CASH',
  source: 'CASH',
});
```

## Help & Documentation

- 📖 **Full Documentation:** [README.md](README.md)
- 🔧 **Implementation Guide:** [IMPLEMENTATION.md](IMPLEMENTATION.md)
- ✅ **Build Summary:** [BUILD-SUMMARY.md](BUILD-SUMMARY.md)

## Troubleshooting

### Database Connection Error
```bash
# Check PostgreSQL is running
# Verify DATABASE_URL in .env
# Try: npx prisma db push --force-reset
```

### Module Not Found
```bash
npm install
npx prisma generate
```

### Port Already in Use
```bash
# Change port in .env:
# PORT=3001
# Or kill the process using port 3000
```

## Need Help?

Check the [IMPLEMENTATION.md](IMPLEMENTATION.md) guide for:
- Detailed setup instructions
- Testing procedures
- Common issues & solutions
- Production deployment
- Monitoring setup

---

**🎉 You're all set! Start building your payment system now.**
