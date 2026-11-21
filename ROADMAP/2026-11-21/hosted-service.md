# Hosted service — 2026-11-21

Goal: deploy templaitor on a server as a multi-user service: user login, organizations, the editor per
organization, and a sending service for hosted templates (template + data) and for HTML sent by the client.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Template storage | **Configurable**: `fs` (a templaitor project folder per organization; an org can point to an existing folder, e.g. a git checkout) or `db` (files stored in the database, materialized into a working-directory cache for the engine) | The engine and the editor keep working on a project directory; `fs` keeps git/export workflows, `db` makes the server stateless apart from the database |
| Database | **SQLite now** (built-in `node:sqlite`, Node ≥ 22.13), **Postgres later** behind the same data-access layer | One container, no extra services; the repository layer isolates SQL so a Postgres adapter is a drop-in |
| Login | **Email OTP** (6-digit code, 10 min, hashed, limited attempts) + **passkeys** (WebAuthn, `@simplewebauthn`) | No passwords to store or leak; passkeys are phishing-resistant |
| Sessions | Opaque token in an `HttpOnly; Secure; SameSite=Lax` cookie, stored hashed | Revocable, no JWT secrets in the browser |
| Sending | **SMTP per organization** (works with SES, Postmark, Mailgun, Brevo, own server…), persistent queue in the DB with retries and a send log; HTTP API with **API keys** | Provider-agnostic; one code path |
| Secrets | SMTP passwords encrypted at rest (AES-256-GCM with `TEMPLAITOR_SECRET`); API keys and OTPs stored as hashes | A database leak does not leak credentials |
| CLI / local editor | **Must keep working unchanged** (`templaitor editor`, `make up`, `compile`, Node ≥ 20). The service is `templaitor serve` (Node ≥ 22.13), loaded only in that mode; the editor detects the mode (`/auth/session` missing → local, no login) | The service is an extra layer, not a fork |

## Send API (v1)

```
POST /v1/send                     Authorization: Bearer tpl_…   (Idempotency-Key: optional)
  hosted:  { template: "orders/order-confirmation", lang: "es", data: {…}, to, cc?, bcc?, replyTo? }
  raw:     { subject, html, text?, to, cc?, bcc?, replyTo?, from?,
             attachments?: [{ filename, content (base64) | url, contentType? }] }
→ 202 { id, status: "queued" }
GET  /v1/messages/:id             → status (queued · sending · sent · failed), attempts, last error
POST /v1/render                   → { subject, html, text, attachments[] } without sending
```

Hosted sends render the template in `lang` (fallback: the org's default language), with its
`attachments` (local PDFs rendered in that language, remote files downloaded).

```mermaid
gantt
    title templaitor — hosted service
    dateFormat YYYY-MM-DD
    axisFormat %d %b

    section Foundation
    Service config, `templaitor serve`, data-access layer + SQLite migrations :s1, 2026-11-21, 2d
    Organizations, memberships (roles), invitations                          :s2, after s1, 1d
    Storage drivers: fs (folder per org) and db (materialized cache)          :s3, after s1, 2d

    section Authentication
    Email OTP login, sessions, system SMTP for service emails                 :a1, after s1, 2d
    Passkeys (WebAuthn): register, sign in, manage                            :a2, after a1, 2d

    section Editor as a service
    Org-scoped editor API (auth + roles), login screen, org switcher          :e1, after a1, 2d
    Settings UI: members, SMTP, API keys, send log                            :e2, after e1, 3d

    section Sending service
    API keys, POST /v1/send (hosted + raw), /v1/render                        :m1, after s2, 2d
    Persistent queue, worker, retries with backoff, send log                  :m2, after m1, 2d
    Idempotency keys, rate limits per org                                     :m3, after m2, 1d

    section Deployment
    Dockerfile (WeasyPrint included), compose, health check, backups          :d1, after m2, 1d
    Postgres adapter                                                          :d2, after d1, 3d
```

## Out of scope for now

- Provider HTTP APIs and their webhooks (bounces, opens) — SMTP only.
- Billing, quotas per plan.
- Several instances behind a load balancer (needs Postgres and the `db` storage driver first).
