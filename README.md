# Legacy Wholesale CRM — Rebuilt Project

This rebuild preserves the original CRM website layout and behavior while adding a clean npm/Vite/Express project around it.

## Install location

Copy the CONTENTS of this folder into:

`C:\Users\tysir\OneDrive\Desktop\LegacyWholesaleCRM`

The root must contain `package.json`.

## First install

PowerShell:

```powershell
cd "C:\Users\tysir\OneDrive\Desktop\LegacyWholesaleCRM"
npm install
npm run dev
```

Or:

```powershell
.\scripts\Install-Npm.ps1
npm run dev
```

## URLs

- CRM frontend: `http://localhost:5173`
- API health check: `http://localhost:8787/api/health`

## Important layout rule

`legacy/original-wholesale-crm.html` is the untouched original source-of-truth.

The rebuild only extracted:
- inline CSS -> `src/styles/app.css`
- inline JavaScript -> `src/js/app.js`

The body markup remains intact in `index.html`. This minimizes visual/layout regression.

## Folder structure

```text
LegacyWholesaleCRM/
├── index.html
├── package.json
├── vite.config.js
├── Start-CRM.ps1
├── Start-CRM.cmd
├── Install-Npm.cmd
├── .env.example
│
├── src/
│   ├── styles/app.css
│   ├── js/app.js
│   └── components/
│       ├── layout/
│       └── views/
│
├── server/
│   ├── index.js
│   ├── routes/
│   ├── services/
│   ├── integrations/
│   ├── middleware/
│   └── config/
│
├── scripts/
│   ├── Install-Npm.ps1
│   └── Reset-Npm.ps1
│
├── legacy/
│   └── original-wholesale-crm.html
├── data/
└── logs/
```

## Development rule

Do not rebuild the whole app for small changes.

- Layout changes -> `src/components/layout/`
- Pipeline changes -> `src/components/views/`
- Existing styles -> `src/styles/app.css`
- Existing browser behavior -> `src/js/app.js`
- Backend routes -> `server/routes/`
- Business logic -> `server/services/`
- Twilio/AI/Podio/Calendar -> `server/integrations/`
