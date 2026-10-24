# ProdKeeper

A Windows desktop control panel for maintaining apps that are already in production: git branches, deploys, backups, CI status, live health checks and an encrypted password vault in one place.

Built with Electron and vanilla JS (no UI framework, no build step).

## Features

- **Git** – status, fetch / pull / push, branches, tags, recent commits.
- **Deploy** – your own commands with a pre-flight checklist, live output and a post-deploy health check.
- **Live status** – HTTP checks with status code, latency, SSL expiry and uptime.
- **Backups** – zip a folder or run any command, with retention and optional schedule.
- **CI/CD** – GitHub Actions runs: view, re-run, cancel, dispatch.
- **Vault** – AES-256-GCM encrypted secrets, injectable into commands as `NAME=@label` and masked in logs.
- **Tray & alerts** – one alert list across all apps, Windows notifications, daily-task reminders.

## Security

All stored data is encrypted with AES-256-GCM, using a key derived from your master password with scrypt. The renderer is sandboxed, git operations are allow-listed, and there is no telemetry. The master password cannot be recovered, and the project has not been independently audited.

## Getting started

Requires Windows 10/11, Node.js 20+ and Git.

```bash
npm install
npm start       # run in development
npm run dist    # build dist/ProdKeeper.exe (portable)
```

## License

[MIT](LICENSE)
