# Railway demo deployment

Deploy three services from this repository into the **same Railway project, environment and
region**. Keep one replica per service; chat dispatch is currently in-process. Supabase provides
PostgreSQL and private Storage buckets, and Resend provides authentication emails.

```text
Browser -- HTTPS --> gateway:8080
                       |-- /api/v1/* --> api:3001 --> Supabase / Resend / Omise (optional)
                       `-- everything else --> web:3000
```

Only `gateway` has a public domain. REST, refresh cookies and Socket.IO polling/WebSocket Upgrade
all use this origin. The gateway preserves request paths, query strings, Origin, Host and the
HTTPS forwarding header. It refreshes private DNS so upstream redeploys do not require restarting
the gateway. Its 6 MiB request limit accommodates the API's 5 MiB document limit plus multipart
metadata; the API still validates individual files.

## 1. Create the services

Push these files to GitHub. Create a Railway project and three services named **exactly** `api`,
`web` and `gateway`, each connected to the same repository and branch. Configure them before
deploying. For each service, leave **Root Directory** at the repository root (`/`). Set the
`RAILWAY_DOCKERFILE_PATH` service variable and the **Settings > Deploy > Healthcheck Path**:

| Service | RAILWAY_DOCKERFILE_PATH   | PORT | Healthcheck Path |
| ------- | ------------------------- | ---- | ---------------- |
| api     | apps/api/Dockerfile       | 3001 | /api/v1/health   |
| web     | apps/web/Dockerfile       | 3000 | /                |
| gateway | deploy/railway/Dockerfile | 8080 | /                |

**New services: use Dashboard settings, not the JSON config files.** Railway's current
[Config as Code documentation](https://docs.railway.com/config-as-code) says new services cannot
opt into `railway.json`/`railway.toml`, and existing use ends on 2026-12-01. The `api.json`,
`web.json` and `gateway.json` files here are legacy references; do not select them for a new
service. Dockerfile builds selected with `RAILWAY_DOCKERFILE_PATH` still work independently.

Do not select `apps/api` or `apps/web` as Root Directory: both builds need the root lockfile and
shared workspace packages. Leave custom Build, Start and Pre-deploy commands empty; the images
already define their build/start commands. Railway runs each service separately, not Compose.
The API/web Dockerfiles use normal Docker layer caching rather than BuildKit cache mounts,
which Railway requires to contain a hard-coded service ID. No account-specific IDs are needed.

In `gateway` Networking, generate a Railway public domain with **target port 8080**. Do not
generate public domains or TCP proxies for `api` and `web`. Keep serverless/app sleeping disabled
for the demo so the first visitor does not need to wake multiple services. In each service's
Deploy settings, use one replica, a 300-second healthcheck timeout, and an On Failure restart
policy with at most three retries.

## 2. Set service variables

Paste the following blocks into each service's Variables Raw Editor. Railway's `${{...}}`
expressions are service references, not shell commands. Replace every bracketed placeholder.
If you rename a service, update its references too. Never put API secrets into shared project
variables, the web/gateway service, build arguments, or `NEXT_PUBLIC_*` variables.

### api

```dotenv
RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[URL_ENCODED_PASSWORD]@[DB_REGION].pooler.supabase.com:5432/postgres?sslmode=require
SUPABASE_URL=https://[PROJECT_REF].supabase.co
SUPABASE_SECRET_KEY=sb_secret_[REPLACE_ME]
SUPABASE_AVATAR_BUCKET=[PRIVATE_AVATAR_BUCKET]
SUPABASE_DOCUMENT_BUCKET=[PRIVATE_DOCUMENT_BUCKET]
JWT_ACCESS_SECRET=[RANDOM_ACCESS_SECRET_AT_LEAST_32_CHARACTERS]
JWT_REFRESH_SECRET=[DIFFERENT_RANDOM_REFRESH_SECRET_AT_LEAST_32_CHARACTERS]
RESEND_API_KEY=[RESEND_API_KEY]
EMAIL_FROM=HKTutor <no-reply@[VERIFIED_SENDING_DOMAIN]>
APP_URL=https://${{gateway.RAILWAY_PUBLIC_DOMAIN}}
WEB_ORIGIN=https://${{gateway.RAILWAY_PUBLIC_DOMAIN}}
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
COOKIE_DOMAIN=
```

Use the Supabase **session pooler on port 5432**, with a UTC database. Pre-create two distinct,
private Storage buckets. Generate the JWT secrets locally with two separate invocations of
`openssl rand -base64 48`. Resend's sender must belong to a verified sending domain; its sandbox
sender cannot deliver demo registration emails to arbitrary recipients.

For a custom gateway domain, replace both `APP_URL` and `WEB_ORIGIN` with that exact HTTPS origin
(no trailing slash) and redeploy `api`. `COOKIE_DOMAIN` stays empty for a host-only cookie.

**Optional PromptPay:** omit both `OMISE_SECRET_KEY` and `OMISE_WEBHOOK_SECRET` to disable QR
payments. Do not copy the example `REPLACE_ME` values. To demonstrate payments, configure both
real **test-mode** values in `api` only, and set the public Omise webhook URL according to the
[payment runbook](../../apps/api/README.md#promptpay-test-payments). Without these keys, QR creation
returns 503; the rest of the app remains available. Live-money payments are not supported.

### web

```dotenv
RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile
PORT=3000
HOSTNAME=::
API_INTERNAL_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}
```

`HOSTNAME=::` accepts the private network's IPv6 connections and IPv4 via Node's dual-stack
listener. `API_INTERNAL_URL` is a Docker build argument in the existing web Dockerfile: Railway
passes the service variable to the build because the Dockerfile declares it with `ARG`.
Next.js bakes the REST rewrite into its build. Changing the value requires a **rebuild**, not
only a restart. No private-network connection is needed during compilation. Browser traffic
normally reaches `api` directly through the gateway instead of this Next.js REST fallback.

### gateway

```dotenv
RAILWAY_DOCKERFILE_PATH=deploy/railway/Dockerfile
PORT=8080
API_INTERNAL_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}
WEB_INTERNAL_URL=http://${{web.RAILWAY_PRIVATE_DOMAIN}}:${{web.PORT}}
```

These upstream URLs must be internal HTTP origins without a path or trailing slash. The Nginx
image renders its template at startup, uses the container's DNS resolvers (including IPv6), and
listens on Railway's `PORT`. It works even when an upstream is not yet resolvable at startup;
requests return 502 until that upstream is ready. TLS is terminated by Railway.

## 3. Prepare the demo database, then deploy

Migrations and seeds are deliberately **not** run at image build, startup, or pre-deploy. The API
runtime image contains production dependencies, not the Prisma CLI. Do not add
`pnpm db:migrate:deploy` as a Railway pre-deploy command for this image.

From a local checkout with Node.js 24.19.0 and pnpm 11.19.0, confirm that the ignored root `.env`
points to the intended **demo database**, and back it up first if it already contains shared data.
Then run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate:status
pnpm db:migrate:deploy
```

For demo accounts/fixtures, optionally configure the `SEED_*` variables locally and run
`pnpm db:seed` against that same confirmed demo database. Neither this guide nor the images
reset or migrate any database automatically.

Deploy `api` and `web` first, wait for their health checks, then deploy `gateway`. The gateway's
health check fetches `/` through `web`; API readiness is checked separately by the API service.
Use the public gateway URL for every browser tab and email flow, not an upstream URL.

## 4. Verify before sharing

At `https://<gateway-domain>`:

1. `/` loads and `/api/v1/health` returns `{"database":"connected"}`.
2. Register, receive the verification email, and verify using a link on the gateway domain.
3. Sign in, reload, and confirm refresh works. Refresh cookies must be Secure and HttpOnly,
   and the browser must not call a `railway.internal` address.
4. Open student and tutor accounts in separate browser profiles. Confirm chat sends, read receipts,
   Socket.IO polling, and a WebSocket Upgrade with status **101** on `/api/v1/socket.io/`.
5. Upload an avatar and a document larger than 1 MiB but within the API's 5 MiB document limit.
6. Redeploy `api`, then reopen chat and confirm reconnect/reconciliation works. The gateway should
   discover the new private address after its 10-second DNS cache expires.

For 502 responses, check upstream health, private hostname references, matching ports and
`web`'s `HOSTNAME=::`. For email/socket origin errors, compare `APP_URL` and `WEB_ORIGIN` against
the exact browser origin. Gateway access logs omit query strings; routine upstream error logs
are suppressed so verification/reset tokens do not appear there.

For a one-day demo, check Railway's remaining trial credit before the presentation, then remove
the three demo services afterward if they are no longer needed. Trial eligibility, outbound
network access and available credit are account-specific; a Limited Trial may block the
Supabase connection. This configuration does not guarantee free uptime.

## Local verification

```bash
docker build -f deploy/railway/Dockerfile -t hktutor-railway-gateway:local .
docker pull node:24.19.0-bookworm-slim
node --test tests/railway-deployment.test.mjs
HKTUTOR_TEST_RAILWAY_GATEWAY=1 node --test tests/railway-gateway.test.mjs
```

The opt-in gateway test uses only temporary Docker containers/networks and synthetic upstreams;
it does not connect to a database or external provider. It exercises HTTP routing, cookies,
uploads, WebSocket Upgrade, startup before DNS exists, and recovery after an upstream address
changes. It does not certify Railway's real TLS ingress or live user journeys above.

References: [Railway config](https://docs.railway.com/config-as-code/reference),
[Dockerfile builds](https://docs.railway.com/builds/dockerfiles),
[private networking](https://docs.railway.com/networking/private-networking).
