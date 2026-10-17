# AppWarden

A Windows desktop control panel for **maintaining apps that are already in production** — not for planning them.
One place for the things you keep jumping between: git branches, passwords, deploys, backups, CI/CD and "is it up?".

UI language: **Persian (RTL)**. Built with Electron, no framework, no build step for the UI.

> فارسی: ابزار ویندوزی برای نگهداری برنامه‌های در حال اجرا — کنترل شاخه‌های git، گاوصندوق رمز رمزنگاری‌شده، استقرار، بک‌آپ، وضعیت CI/CD و پایش زندهٔ سایت‌ها. توضیح فارسی در انتهای همین فایل است.

## Features

| Area | What it does |
|---|---|
| **Git & branches** | Status (dirty / ahead / behind), fetch / pull / push, create / checkout / merge / delete branches (local and remote), tags, recent commits. Merged branches are flagged for cleanup. |
| **Deploy** | Define your own deploy commands (SSH, docker compose, scp, …). A pre-flight checklist shows branch, uncommitted changes, unpushed commits and last CI result before you run. Live output, stop button, post-deploy health check. |
| **Live status** | Sends real HTTP requests to each environment: status code, response time, SSL expiry, uptime %, latency history, and the fields of a JSON `/health` response. Custom endpoint, method, expected status / keyword and auth headers. Plus an ad-hoc request tester. |
| **Backups** | Zip a folder (with excludes) or run any command (e.g. `mysqldump`). Retention (keep last N), optional schedule while the app is open, file list of existing backups. |
| **CI/CD** | GitHub Actions: recent runs, re-run, cancel, manually dispatch a workflow. Works without a token for public repos. |
| **Password vault** | Everything is encrypted at rest (see *Security*). Copy with auto-clear, reveal for 15 s, expiry dates with warnings, generator. Secrets can be injected into deploy/backup commands as `NAME=@label` and are masked in logs. |
| **Dashboard** | One alert list across all apps: site down, failing CI, failed deploy/backup, stale backup, dirty/unpushed repo, expiring SSL or secrets. |

## Security model

* Everything the app stores (projects, commands, logs, vault) is encrypted with **AES-256-GCM**. The key is derived from your **master password** with **scrypt** (N=2¹⁶, r=8, p=1) and is never written to disk; it is wiped from memory when the app locks (manual or idle auto-lock).
* Files are authenticated: tampering with `data.enc` / `vault.enc` is detected.
* Failed unlock attempts are rate-limited. Clipboard is cleared 20 s after copying a secret and on lock / quit.
* Secrets injected into commands via `@label` are masked in the displayed and stored logs.
* The renderer is sandboxed (`contextIsolation`, no `nodeIntegration`, strict CSP); git operations are a fixed allow-list (no free-form arguments from the UI); no telemetry — the app only contacts URLs you configure and `api.github.com` for CI.
* Encrypted export (`.awbak`) can be restored on any machine with the master password.

**Limits — please read.** The master password cannot be recovered. Malware running as your user while the app is *unlocked* can read process memory or log keystrokes. Deploy and backup commands run on your machine with your privileges, so only define commands you trust. This project has **not been independently audited** — keep your most critical credentials (root, production DB) in an audited password manager and use SSH keys where you can.

## Getting started

Requirements: Windows 10/11, Node.js 20+, Git on `PATH`.

```bash
npm install
npm start          # run in development
npm run dist       # build dist/AppWarden.exe (portable)
```

Data lives in `%APPDATA%\AppWarden` (`security.json`, `data.enc`, `vault.enc`, and daily encrypted copies in `backups/`).

## Project layout

```
main.js            Electron main process, IPC wiring
preload.js         the only bridge exposed to the UI
lib/secure.js      key derivation, encrypted store, lock, backup bundle
lib/vault.js       vault entries, env/header injection, log masking
lib/git.js         allow-listed git operations
lib/jobs.js        deploy/backup runner, retention, process control
lib/net.js         health checks, GitHub Actions API
renderer/          UI (vanilla JS): util.js, views.js, app.js, styles.css
```

## License

[MIT](LICENSE)

---

## توضیح فارسی

AppWarden برای **نگهداری برنامه‌هایی** است که پروژه‌شان تمام شده و در حال اجرا هستند:

* **Git:** وضعیت مخزن، شاخه‌ها (ساخت، ادغام، حذف، پاک‌سازی شاخه‌های ادغام‌شده)، تگ‌ها.
* **استقرار:** دستور دلخواه، چک‌لیست پیش از اجرا (شاخه، تغییرات کامیت‌نشده، وضعیت CI)، خروجی زنده و بررسی سلامت بعد از استقرار.
* **وضعیت زنده:** ارسال درخواست واقعی به سایت‌ها و نمایش کد پاسخ، زمان پاسخ، آپ‌تایم، انقضای SSL و فیلدهای JSON پاسخ.
* **بک‌آپ:** zip پوشه یا اجرای دستور (مثل `mysqldump`)، نگهداری N نسخهٔ آخر، اجرای زمان‌بندی‌شده.
* **CI/CD:** وضعیت GitHub Actions، اجرای مجدد و اجرای دستی.
* **گاوصندوق رمز:** همه‌چیز با رمز اصلی و AES-256 رمزنگاری می‌شود؛ قفل خودکار، پاک‌شدن کلیپ‌بورد، پنهان‌شدن رمزها در لاگ‌ها.

رمز اصلی قابل بازیابی نیست و این پروژه ممیزی امنیتی مستقل نشده است؛ رمزهای بسیار حساس را در یک مدیر رمز بازبینی‌شده نگه دارید.
