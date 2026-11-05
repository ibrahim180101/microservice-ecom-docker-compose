# NOVA Commerce checkout setup

## Implemented
- Checkout form collects delivery name, email, phone, street address, city, state, and Indian PIN code.
- COD creates an order with status `placed` and paymentStatus `pending_cod`.
- Online payment is disabled in the UI until both Razorpay credentials are configured.
- When configured, the backend creates a Razorpay order in INR paise using server-calculated catalog prices; the browser opens Razorpay Checkout; the backend verifies Razorpay's payment signature before marking an order paid.
- Existing orders remain in the Docker named volume `order-service-data`. Existing order records are preserved.
- Public order responses omit customer contact/address details.

## Configure online payments
1. Obtain your own Razorpay merchant account, complete the required verification, and use **test-mode** credentials first.
2. On Docker EC2, store secrets outside GitHub, e.g. a root/ubuntu-owned restricted environment file at `/home/ubuntu/microservices-deploy/.env.checkout` containing:
   `RAZORPAY_KEY_ID=rzp_test_...`
   `RAZORPAY_KEY_SECRET=...`
3. Add the following to the `order-service` stanza in `deploy/docker-compose.yml` when ready:
   `env_file: [ .env.checkout ]`
   Do not commit the real file or secrets. Jenkins currently copies only docker-compose.yml and nginx.conf; the environment file must be provisioned separately on Docker EC2.
4. Redeploy and confirm `GET /api/checkout/config` returns `onlinePaymentsEnabled: true`.
5. Test success, failure, cancellation, refresh, and repeated verification using Razorpay test payments before live keys.

## IMPORTANT: not production-ready yet
- Site currently uses plain HTTP on an EC2 public IP. **Do not collect real customer addresses or take live payments until HTTPS with a valid domain/TLS certificate is deployed.**
- There is no login, authorization, customer ownership isolation, admin workflow, inventory reservation, refund workflow, or delivery integration. The public order listing exposes order metadata; protect it before accepting real customers.
- The file-based JSON order store is for learning only. Move to a transactional database (PostgreSQL), add migrations, backups, audit logs, and idempotency.
- Add verified Razorpay webhooks (including payment capture/failure/refund handling), server-side reconciliation, and reliable payment retry flow before live launch. Signature verification alone does not cover all payment lifecycle events.
- Validate stock, serviceability, shipping costs, taxes, and fulfillment policies before accepting orders.
- Avoid production secrets in GitHub, Jenkins logs, browser JavaScript, or Docker images.
- Never collect card numbers/CVV directly.
