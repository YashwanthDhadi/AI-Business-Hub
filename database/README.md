# Database — Supabase / PostgreSQL

Schema and demo data for AI Business Hub.

## Layout

```
database/
├── migrations/
│   ├── 001_customer_support_agent.sql
│   ├── 002_booking_agent.sql
│   ├── 003_customers_agent.sql
│   ├── 004_payments_agent.sql
│   ├── 005_inventory_agent.sql
│   ├── 006_documents_agent.sql
│   ├── 007_communication_agent.sql
│   └── 008_reports_agent.sql
└── seed.sql        the demo business, Pulse Fitness Studio
```

## Applying

Paste each migration into the Supabase **SQL Editor** in numeric order, then
`seed.sql`. Never edit a migration that has already been applied — add a new
numbered file instead. Full steps are in [SETUP.md](../SETUP.md).

## Tenant isolation

The backend connects with the `service_role` key, which bypasses row-level
security. Isolation is therefore enforced in two places:

1. every repository function in `backend/app/repositories/` filters `business_id`;
2. composite foreign keys `(id, business_id)` make Postgres refuse a
   cross-tenant row even if the Python is wrong.

`backend/scripts/check_tenant_isolation.py` verifies both.
