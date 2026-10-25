# ProdKeeper

A Windows desktop control panel for maintaining apps that are already in production: git branches, deploys, backups, CI status, live health checks and an encrypted password vault in one place.

Built with Electron and vanilla JS (no UI framework, no build step).

## Features

- **Git** – status, fetch / pull / push, branches, tags, recent commits.
- **Deploy** – your own commands with a pre-flight checklist, live output and a post-deploy health check.
- **Live status** – HTTP checks with status code, latency, SSL expiry and uptime.
- **Backups** – zip a folder or run any command, with retention and optional schedule.
- **CI/CD** – GitHub Actions runs: view, re-run, cancel, dispatch.
- **Agile board** – per-app kanban (Backlog → To do → In progress → Done) with drag and drop, WIP limit, story-point estimates, optional sprints with a closing retrospective, and tasks linked to git branches (a task closes itself when its branch is merged).
- **Tasks popup** – a small always-on-top window that stays pinned above other windows until you close it (Ctrl+Alt+T toggles it, also in the tray menu; drag the header to move it) listing what is in progress and to do; tick a task to finish it, click it to open the app. It shows nothing while the app is locked.
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
