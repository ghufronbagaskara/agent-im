# AGENTS.md - agent-im Hermes Deployment Profile

This repo is no longer the old custom Node.js Discord bot. It is now a
deployment profile for Nous Research Hermes Agent, customized for Isaac/MAXY.

## Purpose

Use this repository to reproduce the running Hermes setup:

- install Hermes Nous from the pinned `hermes-agent` submodule
- restore safe Hermes home files from `hermes-home/`
- keep MAXY skills, cron jobs, config, and persona under version control
- keep secrets and runtime state out of Git

Do not copy this repo into the VPS as a replacement for live runtime state.
Deploy by cloning it, filling `~/.hermes/.env`, then running
`bash deploy/install.sh`.

## Structure

| Path | Responsibility |
| --- | --- |
| `hermes-agent/` | Git submodule for upstream NousResearch Hermes Agent. |
| `hermes-home/config.yaml` | Safe Hermes config restored to `~/.hermes/config.yaml`. |
| `hermes-home/SOUL.md` | Persona/profile restored to `~/.hermes/SOUL.md`. |
| `hermes-home/cron/jobs.json` | Scheduled job definitions. Do not store cron output. |
| `hermes-home/skills/` | User/bundled skills to restore, including MAXY context. |
| `deploy/install.sh` | Linux VPS install/restore script. |
| `deploy/snapshot-from-server.ps1` | Pull safe profile files from current VPS into this repo. |
| `.env.example` | Names of required secrets; values stay outside Git. |

## Runtime Model

Live runtime should use:

- Hermes home: `~/.hermes`
- Hermes source: `~/.hermes/hermes-agent`
- Gateway service: `hermes-gateway.service`
- Command: `python -m hermes_cli.main gateway run`

The repo stores deployable source/profile only. Runtime files such as
`~/.hermes/.env`, `auth.json`, `state.db`, `kanban.db`, `sessions/`, `logs/`,
`cache/`, and request dumps must never be committed.

## Deployment

Fresh deploy:

```bash
git clone --recurse-submodules git@github.com:YOUR_USERNAME/agent-im.git
cd agent-im
mkdir -p ~/.hermes
cp .env.example ~/.hermes/.env
nano ~/.hermes/.env
bash deploy/install.sh
```

Useful checks:

```bash
systemctl --user status hermes-gateway.service
journalctl --user -u hermes-gateway.service -n 200 --no-pager
~/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main status
~/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main cron list
```

## Updating From The Running VPS

From local PowerShell:

```powershell
.\deploy\snapshot-from-server.ps1
git status
git add hermes-home AGENTS.remote.md
git commit -m "Update Hermes profile"
git push
```

Review diffs before committing. If a snapshot includes secrets or runtime dumps,
stop and remove them before `git add`.

## Security Rules

- Never commit `.env`, `auth.json`, API tokens, cookies, logs, DB files, or raw
  session/request dumps.
- Do not commit `venv/`, `node_modules/`, caches, or generated cron output.
- Keep memory that should be versioned as explicit Markdown or skill files,
  not raw SQLite DB state.
- If fully automated secret restore is needed later, use encrypted secrets
  tooling such as `sops`/`age`; never plaintext GitHub secrets.

## Current Customization

Important MAXY files live under `hermes-home/skills/maxy/`:

- `maxy-context/SKILL.md`
- `fathom/SKILL.md`

Cron definitions live in `hermes-home/cron/jobs.json`.

## Git Safety

Do not run destructive Git commands or force-push unless explicitly requested.
Do not commit or push unless explicitly requested.
