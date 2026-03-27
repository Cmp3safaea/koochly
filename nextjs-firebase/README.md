# nextjs-firebase (Firestore) + Docker (Cloud Run)

This project is a Next.js app with:
- A Firestore-backed API (`/api/todos`) using `firebase-admin`
- A production `Dockerfile` that runs the Next.js standalone server on port `8080`

## Configure Firebase Admin

Set credentials in one of these ways:

1. **Cloud Run / GCP recommended (ADC)**: bind a service account to the Cloud Run service that has Firestore permissions.  
   In this case you do **not** need `FIREBASE_SERVICE_ACCOUNT_KEY`.

2. **Local / generic**: set `FIREBASE_SERVICE_ACCOUNT_KEY` to the raw service account JSON (store it as a Secret on Cloud Run).
3. **Alternative**: set `FIREBASE_SERVICE_ACCOUNT_KEY_BASE64` (base64 of the service account JSON).
4. **Alternative**: set `GOOGLE_APPLICATION_CREDENTIALS` to a file path containing the service account JSON (common locally).

## Create the service account (Firestore access)

1. In the Firebase Console, go to **Project Settings** -> **Service accounts**.
2. Click **Generate new private key** and store the JSON file securely.
3. Grant the service account access to Firestore (at least one of these roles):
   - `roles/datastore.user` (basic read/write)
   - or a more specific Firestore role that matches your needs

## Run locally

```bash
cp .env.example .env
# edit .env if using option B
npm run dev
```

Hit:
- `GET /api/todos`
- `POST /api/todos` with JSON body: `{ "text": "..." }`

## Docker build

```bash
docker build -t nextjs-firebase:local .
docker run --rm -p 8080:8080 -e PORT=8080 nextjs-firebase:local
```

## Cloud Run deploy (high level)

Build/push the image to a registry, then deploy with:
- a service account that can access Firestore (recommended), or
- set `FIREBASE_SERVICE_ACCOUNT_KEY` as an environment variable/secret
- ensure the container listens on `PORT` (this image uses `8080`)

## SEO operations

Run basic SEO endpoint checks:

```bash
npm run seo:verify
```

Generate a priority URL list for Search Console indexing:

```bash
npm run seo:priority-urls
```

Use a production domain:

```bash
SEO_BASE_URL="https://YOUR_DOMAIN" npm run seo:verify
SEO_BASE_URL="https://YOUR_DOMAIN" npm run seo:priority-urls
```

Operational runbooks:

- `docs/seo-search-console-runbook.md`
- `docs/seo-weekly-process.md`

