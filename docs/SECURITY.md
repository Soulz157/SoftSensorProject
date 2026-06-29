# Security Policy

This document outlines the security policies, vulnerability reporting guidelines, and best practices for the project utilizing the following technology stack:

- **Frontend:** Next.js 15 (App Router)
- **Backend:** NestJS 11
- **ORM & Database:** Prisma ORM & PostgreSQL
- **Services:** Mailer Integration (SMTP)

---

## 1. Supported Versions

We prioritize security updates for the currently active major versions. If a vulnerability is found in an older version, we strongly recommend upgrading to the latest versions as shown below:

| Technology       | Support Status |
| ---------------- | -------------- |
| Next.js 16 .x    | Supported ✅   |
| NestJS 11.x      | Supported ✅   |
| Prisma 5.x / 6.x | Supported ✅   |
| PostgreSQL 15+   | Supported ✅   |

---

## 2. Reporting a Vulnerability

If you discover a security vulnerability within this project, **please do not disclose it publicly (e.g., by opening a GitHub Issue)**. Instead, follow these steps:

1. Send a vulnerability report to: `phoorich.oscar@gmail.com` (Please update this email address).
2. Include the following information in your report:
   - A detailed description of the vulnerability.
   - Steps to reproduce the issue or a Proof of Concept (PoC).
   - The potential impact of the vulnerability.
3. The team will acknowledge the receipt of your report within **48 hours** and will keep you updated on the remediation progress.

---

## 3. Security Architecture & Best Practices

This project is designed with a Defense-in-Depth approach across all system layers:

### 🔒 Next.js 16 (Frontend & SSR)

- **Server Actions Security:** Always implement Authentication, Authorization, and Input Validation in every Server Action, as they function similarly to public API endpoints.
- **Environment Variables:** Sensitive information (e.g., Database URLs, Mailer Credentials) must remain on the server. Never prefix sensitive variables with `NEXT_PUBLIC_` to prevent them from leaking to the client-side.
- **Cross-Site Scripting (XSS):** Next.js automatically escapes data to prevent XSS. However, avoid using `dangerouslySetInnerHTML` unless the content is strictly sanitized using libraries like `dompurify`.

### 🛡️ NestJS 11 (Backend API)

- **Input Validation:** Enforce `ValidationPipe` globally alongside `class-validator` and `class-transformer` to whitelist incoming payloads (`whitelist: true`, `forbidNonWhitelisted: true`), preventing Mass Assignment vulnerabilities.
- **Rate Limiting:** Implement `@nestjs/throttler` to mitigate Brute Force and Denial of Service (DoS) attacks on critical API endpoints.
- **HTTP Security Headers:** Use `helmet` to set secure HTTP headers (such as Content Security Policy, X-Frame-Options) to protect against Clickjacking and Sniffing.
- **CORS (Cross-Origin Resource Sharing):** Restrict API access to trusted domains only. Never use `origin: '*'` in a production environment.

### 🗄️ Prisma & PostgreSQL (Database Layer)

- **SQL Injection Protection:** Prisma Client automatically uses parameterized queries, effectively preventing SQL Injection. If raw queries (`prisma.$queryRaw`) are necessary, ensure they are executed using tagged template literals. Never concatenate strings directly into raw queries.
- **Database Connections:** Enforce SSL-encrypted connections (`sslmode=require`) in production to prevent Man-in-the-Middle (MitM) attacks.
- **Least Privilege Principle:** The database user account utilized by the application should only have the minimum privileges required. Avoid using `superuser` or the default `postgres` roles for routine application operations.

### 📧 Mailer Security (Email Service)

- **Secure SMTP Transport:** Enforce TLS/SSL encryption (`secure: true` for port 465, or `starttls` for port 587) when connecting to the SMTP provider.
- **Email Rate Limiting:** Limit the number of emails sent (e.g., Password Reset, OTPs) per user or IP address to prevent spamming and avoid getting the system's email domain blacklisted.
- **Secure Tokens:** Tokens for password resets or email verification must be generated using cryptographically secure algorithms (e.g., `crypto.randomBytes` or UUIDv4), have a short expiration time (e.g., 15-30 minutes), and be one-way hashed before being stored in the database.

---

## 4. Secrets Management & Security Auditing

- **Never commit `.env` files to version control:** Use `.env.example` to share the required environment variable structure.
- **Dependency Auditing:** Regularly scan for vulnerable dependencies using package manager audit tools:

  ```bash
  npm audit # or yarn audit / pnpm audit
  ```

- **Automated Scanning:** Enable automated vulnerability scanning tools such as GitHub Dependabot or Snyk to continuously monitor dependencies
