# agent-im

Deployment profile for Isaac/MAXY Hermes, based on Nous Research Hermes Agent.

This repository intentionally replaces the old custom Node.js Discord bot. The
runtime is Hermes Nous (`hermes-agent` submodule), while MAXY-specific behavior
lives in `hermes-home/` as config, skills, cron jobs, and persona files.

## What Is Stored Here

- `hermes-agent/` - pinned NousResearch Hermes Agent submodule.
- `hermes-home/config.yaml` - non-secret Hermes configuration copied to `~/.hermes/config.yaml`.
- `hermes-home/SOUL.md` - persona/profile copied to `~/.hermes/SOUL.md`.
- `hermes-home/cron/jobs.json` - scheduled Hermes jobs.
- `hermes-home/skills/` - installed skills, including MAXY/Fathom context.
- `deploy/install.sh` - install/restore script for a Linux VPS.
- `deploy/snapshot-from-server.ps1` - local helper to refresh this repo from the running VPS.

## Not Stored Here

Never commit `.env`, `auth.json`, SQLite DBs, sessions, logs, caches, venvs,
node_modules, or request dumps.

## Fresh Deploy

On a new Linux VPS:

```bash
git clone --recurse-submodules git@github.com:YOUR_USERNAME/agent-im.git
cd agent-im

mkdir -p ~/.hermes
cp .env.example ~/.hermes/.env
nano ~/.hermes/.env

bash deploy/install.sh
```

Check runtime:

```bash
systemctl --user status hermes-gateway.service
journalctl --user -u hermes-gateway.service -f
~/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main status
```

## Refresh Profile From Current VPS

From Windows PowerShell on your local machine:

```powershell
.\deploy\snapshot-from-server.ps1
git status
git add .
git commit -m "Update Hermes profile"
git push
```

The snapshot script excludes secrets, DB state, logs, sessions, caches, and cron
outputs. It stores only deployable profile files.

## Update Hermes Upstream

```bash
cd hermes-agent
git fetch origin
git checkout main
git pull
cd ..
git add hermes-agent
git commit -m "Update Hermes upstream"
```

For production stability, prefer pinning a known-good commit instead of floating
on `main`.
