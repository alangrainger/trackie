# Trackie

**Free budgeting software for New Zealand.**

[Trackie](https://trackie.nz) is a hosted deployment of [Actual Budget](https://actualbudget.org) - a fast, private, open-source budgeting app - run free for anyone in Aotearoa. 
No cost, no ads, no data harvesting, New Zealand only.

## About

- **[About this service](docs/about-this-service.md)** - what Trackie is, why it is free, how your data is kept safe.
- **[Security & privacy](docs/security-and-privacy.md)** - the technical detail: identity, per-user isolation, end-to-end encryption, and the per-user, read-only, encrypted NZ bank sync.
- **[Connecting other tools (API access)](docs/api-access.md)** - how to use Actual Budget API tools (such as actual-mcp) with your Trackie account.

## What you get

- **Your own private budget**, created automatically the first time you sign in.
- **Passwordless sign-in** - a one-time code sent to your email. Nothing to remember,
  no password to leak.
- **Optional end-to-end encryption** you control. Turn it on with your own password
  and not even the server can read your budget. (There is no password recovery -
  keep it safe!)
- **No lock-in** - export your full budget any time and take it anywhere.

## Why this repository exists

This is the *actual code* that runs trackie.nz, published in the open so anyone can verify exactly what happens to their financial data. Trackie is standard Actual Budget plus [a small, auditable NZ layer](app/patches/README.md).

## What's different from Actual Budget

Trackie is Actual Budget with a small New Zealand layer on top. That layer adds:

- **Per-user bank sync** - Actual Budget has Akahu integration, but as a single connection set up by an administrator. Trackie changes it to per-user: each person links their own bank with their own personal tokens, stored encrypted.
- **Automatic syncing** - linked accounts refresh on their own when you open your budget (once per day).
- **Privacy-first sign-in** - Actual Budget stores your email. Trackie changes this to a hash of your email so as not to store any personal info.
- **New Zealand defaults** - dates default to DD/MM/YYYY and the week starts on Monday.

## Acknowledgements

- Trackie is built on [Actual Budget](https://actualbudget.org) (MIT)
