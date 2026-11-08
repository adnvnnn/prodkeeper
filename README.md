# ProdKeeper

A Windows desktop control panel for maintaining apps that are already in production: git branches, deploys, backups, CI status, live health checks and an encrypted password vault in one place.

Built with Electron and vanilla JS (no UI framework, no build step).

## Features

- **Git** – status, fetch / pull / push, branches, tags, recent commits.
- **Deploy** – your own commands with a pre-flight checklist, live output and a post-deploy health check; the same tab also holds *Publish to folder* (saved as a zip or a folder, optionally versioned).
- **Live status** – HTTP checks with status code, latency, SSL expiry and uptime.
- **Databases** – define a SQL Server database once (connection kept encrypted in the vault) and manage it from one card: test connection, back up now or on a schedule with retention, run the update / migration command (with a backup first), and restore from any backup file.
- **Backups** – zip a folder or run any command, with retention and optional schedule.
- **CI/CD** – GitHub Actions runs: view, re-run, cancel, dispatch; create the CI workflow file from the project's Build / Test settings; each deploy is shown as a pipeline (tests → CI → deploy → site check), can require a green CI run, run the project tests first, and deploy automatically when CI succeeds.
- **Release strategies and rollback** – a deploy can run *direct*, *rolling* (batches), *blue-green* (fill the idle slot, check it, then switch) or *canary* (traffic steps with a health check between them). Your commands receive `DEPLOY_VERSION`, `DEPLOY_COMMIT`, `DEPLOY_ENV`, `DEPLOY_SLOT`, `CANARY_PERCENT` and so on. A deploy can run a **plan / dry run** first (`terraform plan`, `kubectl diff`, …) and wait for your **approval** (a button, or typing the environment name). Every run is kept as a release record; **Roll back** uses your rollback command, switches the blue-green slot back, or deploys the previous build again, and can happen **automatically** when a deploy fails or the site is unhealthy afterwards. Tests, backup and publish can run in **parallel**. Presets exist for Docker, Kubernetes, Helm, Terraform, Ansible, Argo Rollouts and ArgoCD (GitOps); the deploy card shows commits on the branch that are not deployed yet (drift).
- **Releases** – semantic version suggested from Conventional Commits (`feat`, `fix`, `!` / `BREAKING CHANGE`), release notes generated from the commits, annotated tag, push and GitHub release in one step; the list of deployed releases with their build output; branching strategy (trunk-based or GitFlow) checked before a deploy.
- **Feature flags** – on/off, gradual rollout and A/B variants per environment, written as one JSON file per environment into the repository.
- **Pull requests** – open, review (approve / request changes / comment), create and merge pull requests with their check status, from the CI/CD tab.
- **CI template options** – lint, coverage, dependency audit + secret scan + CodeQL, dependency cache, Linux/Windows runtime matrix, build artifacts and a Docker build, as parallel jobs in the generated workflow.
- **Agile board** – per-project kanban (Backlog → To do → In progress → Done) with drag and drop, a WIP limit shared by all projects (3 tasks in progress in total by default; tasks waiting on CI or a review can be marked Blocked and are not counted), a warning when more than one sprint runs at once, story-point estimates, optional sprints with a closing retrospective, and tasks linked to git branches (a task closes itself when its branch is merged).
- **Reports** – pick any period (last 7 days … this year, or a custom range) for all projects or one, and see what you did: tasks created and completed, open-task trend, commits, deploys / backups / database updates / publishes with success rates, lead time, the four **DORA** measures (deployment frequency, lead time for changes, change failure rate, time to restore), work by app, when you work (weekday × hour), sprints, site uptime and failures, plus the list of completed work. Every figure is compared with the previous period, and "Copy summary" puts a text summary on the clipboard for meetings. Finished operations are kept in a compact long-lived log (the History page is capped), and finished tasks that you delete are still counted.
- **Tasks popup** – a small always-on-top window that stays pinned above other windows until you close it (Ctrl+Alt+T toggles it, also in the tray menu; drag the header to move it) listing what is in progress and to do; tick a task to finish it, click it to open the project. It shows nothing while the app is locked.
- **Vault** – AES-256-GCM encrypted secrets, injectable into commands as `NAME=@label` and masked in logs.
- **Tray & alerts** – one alert list across all projects, Windows notifications.

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
