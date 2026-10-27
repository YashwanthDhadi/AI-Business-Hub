# Frontend — Next.js

The customer chat, the public pay page, the owner dashboard and the admin
console. Next.js 16 (App Router), TypeScript, Tailwind 4.

## Layout

```
frontend/src/
├── app/
│   ├── chat/[businessSlug]/   public customer chat (text + voice)
│   ├── pay/[token]/           public UPI pay page
│   ├── dashboard/             owner dashboard — one folder per capability
│   ├── admin/                 platform admin console
│   ├── business/, auth/       login, registration, onboarding
│   └── api/hub/[...path]/     proxy to the FastAPI backend
├── features/                  screen-specific components, one folder per feature
├── components/                shared UI, navigation and charts
├── lib/                       API client, formatting, constants
├── types/                     shared TypeScript types
├── data/                      demo data for screens not yet wired to the backend
├── hooks/
└── styles/
```

## Commands

```powershell
copy .env.example .env.local   # then fill in the values
npm install
npm run dev                    # http://localhost:3000
npm run lint
npx tsc --noEmit               # typecheck
```

The backend must be running on port 8000 for live screens. See
[RUN-AND-TEST.md](../docs/guides/RUN-AND-TEST.md).
