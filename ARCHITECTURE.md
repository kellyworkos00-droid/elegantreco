# Kelly OS Payments & Reconciliation System - Architecture

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          KELLY OS PAYMENTS                           │
│                  Elegant Steel & Fabrication Kenya                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         PAYMENT CHANNELS                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │   M-Pesa     │  │   Eazypay    │  │     Bank     │             │
│  │   PayBill    │  │              │  │  Statement   │             │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘             │
│         │                  │                  │                      │
│         │ STK Push/C2B     │ Webhook         │ CSV Upload          │
│         ▼                  ▼                  ▼                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                           API LAYER                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              WEBHOOK HANDLERS (Next.js API Routes)          │   │
│  ├────────────────────────────────────────────────────────────┤   │
│  │  /api/webhooks/mpesa/stkpush   → STK Push Callback        │   │
│  │  /api/webhooks/mpesa/c2b       → PayBill Callback         │   │
│  │  /api/webhooks/eazypay         → Eazypay Webhook          │   │
│  │  /api/dashboard/analytics      → Dashboard Data           │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                      │
│         ┌─────────────────────────────────────────┐                │
│         │    Security Layer                        │                │
│         │  • Signature Verification                │                │
│         │  • Idempotency Checks                    │                │
│         │  • Rate Limiting                         │                │
│         │  • Circuit Breakers                      │                │
│         └─────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        BUSINESS LOGIC LAYER                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│  │ Payment          │  │ Reconciliation   │  │ POS              │ │
│  │ Processor        │  │ Engine           │  │ Service          │ │
│  │                  │  │                  │  │                  │ │
│  │ • Process        │  │ • Fuzzy Match    │  │ • Create Sale    │ │
│  │ • Allocate       │  │ • Auto-Match     │  │ • Track Pending  │ │
│  │ • Reverse        │  │ • Approve Match  │  │ • Close Sale     │ │
│  └─────────┬────────┘  └─────────┬────────┘  └─────────┬────────┘ │
│            │                      │                      │          │
│            └──────────────────────┼──────────────────────┘          │
│                                   ▼                                 │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              CORE FINANCIAL ENGINES                         │   │
│  ├────────────────────────────────────────────────────────────┤   │
│  │  Ledger Engine        Statement Engine    Analytics       │   │
│  │  • Double-entry       • Customer stmt     • Dashboards     │   │
│  │  • Auto-posting       • Running balance   • Reports        │   │
│  │  • Balance tracking   • Transaction log   • Metrics        │   │
│  └────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │                    Prisma ORM                               │   │
│  └────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │                PostgreSQL Database                          │   │
│  ├────────────────────────────────────────────────────────────┤   │
│  │  • Customer          • Invoice          • Payment          │   │
│  │  • PaymentAllocation • PosSale          • LedgerEntry      │   │
│  │  • Account           • CustomerStatement                   │   │
│  │  • WebhookEvent      • BankStatement                       │   │
│  │  • BankTransaction   • AuditLog                            │   │
│  └────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         REAL-TIME SYNC                               │
└─────────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
  ┌──────────┐        ┌──────────┐        ┌──────────┐
  │ Customer │        │ Invoice  │        │   POS    │
  │ Balance  │        │ Status   │        │  Sale    │
  │  Update  │        │  Update  │        │ Closure  │
  └──────────┘        └──────────┘        └──────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │    Analytics     │
                    │     Refresh      │
                    └──────────────────┘
```

## Data Flow - Payment Processing

```
1. PAYMENT RECEIVED
   ┌─────────────────┐
   │  M-Pesa/Eazypay │
   │     Webhook     │
   └────────┬────────┘
            │
            ▼
2. VERIFY & LOG
   ┌─────────────────┐
   │ • Check signature│
   │ • Idempotency    │
   │ • Log webhook    │
   └────────┬────────┘
            │
            ▼
3. MATCH CUSTOMER
   ┌─────────────────┐
   │ • Customer code  │
   │ • Phone number   │
   │ • Invoice number │
   └────────┬────────┘
            │
            ▼
4. PROCESS PAYMENT
   ┌─────────────────┐
   │ • Create payment │
   │ • Allocate (FIFO)│
   │ • Update balance │
   └────────┬────────┘
            │
            ▼
5. POST TO LEDGER
   ┌─────────────────┐
   │ • Debit: Bank    │
   │ • Credit: A/R    │
   │ • Update accounts│
   └────────┬────────┘
            │
            ▼
6. UPDATE STATEMENT
   ┌─────────────────┐
   │ • Add transaction│
   │ • Running balance│
   │ • Audit trail    │
   └────────┬────────┘
            │
            ▼
7. SYNC MODULES
   ┌─────────────────┐
   │ • Close invoices │
   │ • Complete POS   │
   │ • Update stats   │
   └─────────────────┘
```

## Database Schema Relationships

```
Customer ────────┐
   │             │
   ├─────────────┼────── Invoice
   │             │          │
   │             │          ├── InvoiceItem
   │             │          │
   │             └────── Payment
   │                        │
   │                        └── PaymentAllocation
   │
   ├────────── PosSale
   │              │
   │              └── PosSaleItem
   │
   ├────────── LedgerEntry
   │
   └────────── CustomerStatement

Account
   │
   ├────────── LedgerEntry (Debit)
   │
   └────────── LedgerEntry (Credit)

WebhookEvent ───── Payment

BankStatement ───── BankTransaction
```

## Security Layers

```
┌──────────────────────────────────────────────┐
│          EXTERNAL REQUEST                     │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
         ┌─────────────────┐
         │  Rate Limiting   │
         └────────┬─────────┘
                  │
                  ▼
         ┌─────────────────┐
         │    Signature     │
         │   Verification   │
         └────────┬─────────┘
                  │
                  ▼
         ┌─────────────────┐
         │   Idempotency    │
         │      Check       │
         └────────┬─────────┘
                  │
                  ▼
         ┌─────────────────┐
         │    Input         │
         │  Validation      │
         └────────┬─────────┘
                  │
                  ▼
         ┌─────────────────┐
         │   Business       │
         │     Logic        │
         └────────┬─────────┘
                  │
                  ▼
         ┌─────────────────┐
         │   Audit Log      │
         └──────────────────┘
```

## Reconciliation Flow

```
AUTOMATIC                      MANUAL
──────────                    ────────

Bank Statement Upload
        │
        ▼
   Parse CSV
        │
        ▼
   For Each Transaction
        │
        ├──► Auto-Match (High Confidence)
        │       │
        │       ├── Amount = 100%
        │       ├── Date ± 0-2 days
        │       ├── Reference match
        │       │
        │       └──► Auto-Approve ──┐
        │                            │
        └──► Flag for Review ────────┤
                │                    │
                ▼                    │
         Get Suggestions             │
                │                    │
                ▼                    │
         Manual Selection            │
                │                    │
                ▼                    │
            Approve ─────────────────┤
                                     │
                                     ▼
                            Mark Reconciled
                                     │
                                     ▼
                            Update Payment
                                     │
                                     ▼
                              Audit Trail
```

## Module Integration

```
┌──────────────────────────────────────────────────────────┐
│                    KELLY OS MODULES                       │
└──────────────────────────────────────────────────────────┘

    ┌──────────┐     ┌──────────┐     ┌──────────┐
    │   POS    │────▶│ PAYMENTS │◀────│ Finance  │
    └──────────┘     └─────┬────┘     └──────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
    ┌──────────┐     ┌──────────┐     ┌──────────┐
    │Inventory │     │ Customer │     │Analytics │
    └──────────┘     │Management│     └──────────┘
                     └──────────┘

All modules receive real-time updates when:
• Payment is processed
• Invoice is created/updated
• Balance changes
• POS sale completes
```

## Key Design Principles

1. **Atomicity**: All operations use database transactions
2. **Idempotency**: Every webhook can be safely retried
3. **Auditability**: Complete audit trail of all changes
4. **Real-time**: Instant sync across all modules
5. **Security-first**: Multiple layers of protection
6. **Kenyan-optimized**: Built for M-Pesa and local banks

---

**Architecture designed for: Bank-grade reliability with real-time performance**
