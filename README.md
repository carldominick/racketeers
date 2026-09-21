# Racketeers Badminton Tournament Tracker

Standalone Cloudflare deployment of the Racketeers application. Includes tournament setup, individual registrations and pairing, pools and knockout draws, umpire scoring, organizer PIN controls, schedules, projector views, and printable scorecards.

## Deploy from the connected GitHub repository

1. In Cloudflare, create a D1 database named `racketeers-db`.
2. Copy its database ID into `wrangler.json`, replacing the placeholder `database_id`. Keep the binding name `DB`.
3. In Workers & Pages, connect this repository with these settings:
   - Worker name: `racketeers`
   - Production branch: `main`
   - Root directory: repository root
   - Build command: `npm run build`
   - Deploy command: `npm run deploy`
   - Node version: 22.16.0 or newer (Node 24 is also supported).
4. After the Worker is created, go to its Settings → Variables and Secrets. Add a **secret** named `INITIAL_ORGANIZER_PIN`, with a private 4–10 digit PIN. Save/deploy the setting before opening the application.
5. Open the Worker URL and unlock organizer access using that PIN. The application creates its tournament table and initial state on first use. The PIN can subsequently be changed inside the app; changing the secret does not replace a PIN already stored in the database.

The deploy command deliberately refuses deployment while the database ID is still the placeholder. The first API request will fail until the initial PIN secret is configured; this prevents creating a public instance with a known default PIN. Never put PINs, API tokens, or tournament exports into this repository.

## Existing tournament data

This repository contains source code only. It does not include current player records, registration PINs, payment details, or scores from the existing site. A new D1 database begins with a new tournament. Keep using the existing site until a separate data migration has been completed and verified. Do not enter the same event independently on both sites.

## Local development and checks

```sh
npm ci
npm test
npm run lint
npm run build
npm run test:render
```

For a local preview, create an ignored `.dev.vars` file with an `INITIAL_ORGANIZER_PIN` of your choice, then run `npm run dev`. Local development uses local D1 storage, separate from the hosted tournament database.

## Architecture

React and TypeScript, with Vinext/Vite on Cloudflare Workers and D1. The `DB` binding stores the tournament state. Wrangler deploys the generated Vite Worker configuration and static assets. No ChatGPT sign-in or ChatGPT hosting metadata is required.

Cloudflare documentation:
- https://developers.cloudflare.com/workers/vite-plugin/get-started/
- https://developers.cloudflare.com/d1/get-started/
- https://developers.cloudflare.com/workers/configuration/secrets/
