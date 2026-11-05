# PostgreSQL deployment for NOVA Commerce

This migration uses **PostgreSQL 16 in Docker Compose on the existing Docker EC2**, not Amazon RDS. Existing Jenkins, ECR and Nginx topology is retained.

## Required manual preflight on Docker EC2 (before Jenkins can deploy)
1. **Back up the three existing named Docker volumes and any important JSON records before proceeding.** Do not delete them or run `docker compose down -v`. Back up the EC2 instance/snapshot if it contains important records.
2. SSH to Docker EC2 and run:
   ```sh
   cd /home/ubuntu/microservices-deploy
   umask 077
   # Generate a secret, do not put it in Git or share it in chat:
   printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)" > .env
   chmod 600 .env
   ```
3. Run Jenkins build on the `main` branch. Jenkins checks the deployment .env before pulling and starting the PostgreSQL stack.
4. Inspect `docker compose ps` with the correct `IMAGE_TAG` and `docker logs` for postgres/user-service/product-service/order-service.
5. Confirm `GET /health` within each backend container and `GET /api/products` through Nginx. Test registration, login, cart checkout, and per-user order isolation with **dummy data only**.

## Data model
- User service: `users`, `sessions` tables with salted scrypt password hashes and hashed bearer tokens.
- Product service: `products` table with eight seeded products.
- Order service: `orders` table, keyed by UUID and account ID, storing order records as JSONB.
- One PostgreSQL instance/database is used for this assignment. Production should use least-privilege database roles and per-service schemas or databases.

## Legacy JSON migration
The three services still mount their old data volumes. At startup they import existing records with conflict-safe inserts. Product records are refreshed from the legacy catalog. Password-based user accounts are migrated; old demo user records without password hashes are skipped. Legacy orders lacking a linked customer/user ID are skipped. Sessions are **not migrated**; users must sign in again. Keep volume backups for auditing. Repeated migration can overwrite changed product records; stop the legacy migration after confirming cutover.

## Important limitations
- PostgreSQL on a single EC2 is not highly available; implement regular `pg_dump` backups, restore tests, disk monitoring, and restricted access.
- Database port 5432 is **not published** externally. Keep it private.
- The existing public website is HTTP-only. Do not enter real passwords, delivery addresses, or take real payments before TLS/HTTPS and security review.
- Database migrations are currently app-initialized, not versioned; use a migration framework before production.
- Authentication currently stores bearer tokens in browser sessionStorage. Harden session security, rate limiting, CSRF/XSS protections, and authorization before production.
- Payment reconciliation, webhooks, inventory, shipping, taxes, refunds, and customer privacy workflows still require work.
