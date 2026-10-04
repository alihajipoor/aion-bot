# Setting up a development machine

The bot does not run on your computer. It runs on the VPS and is deployed by
GitHub Actions on every push to `main`. A development machine only edits code,
pushes it, and runs the one-off scripts in `tools/setup/`. Moving to a new
computer changes nothing in production.

## 1. Install the tools

On Windows, in PowerShell:

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS
winget install GitHub.cli
```

Close and reopen PowerShell afterwards so the new commands are on your `PATH`.

Node 20 or newer is required (the VPS runs 20). Accept Git's defaults —
`.gitattributes` in this repo pins line endings, so its CRLF setting no longer
matters.

## 2. Get the code

```powershell
gh auth login
gh repo clone alihajipoor/aion-bot
cd aion-bot
npm ci
```

## 3. Check it builds

```powershell
npm run build
npm test
```

Both should pass before you change anything. If `npm test` fails on a clean
clone, something about the machine is wrong, not the code.

## 4. Secrets

Create a file named `.env` in the repository root with exactly two lines:

```
DISCORD_TOKEN=<the bot token>
LIVE_GUILD_ID=1354529874127229079
```

That is all a development machine needs. Every script in `tools/setup/` reads
those two and nothing else.

**Do not copy the VPS's `.env` here.** The database URL, backup passphrase,
panel session secret, API secret and OAuth client secret are used only on the
server. The database is not even reachable from outside the VPS. A secret that
exists on one more machine is one more place it can leak from, for no benefit.

`.env` is in `.gitignore`. It will never be committed.

## 5. Running a setup script

```powershell
node tools/setup/musicaudit.mjs
```

Most of them are dry runs by default and print what they would do. Add
`--apply` to actually change the server.

## Deploying

Push to `main`. That is the whole procedure:

```powershell
git push origin main
```

GitHub Actions builds, tests, uploads to the VPS, runs migrations and restarts
the bot. A deploy takes about three minutes. Watch it with:

```powershell
gh run watch
```

## Running tasks on the server

Things that need the production database — giveaways, the mafia season,
health checks — run on the VPS through the `ops` workflow, not locally:

```powershell
gh workflow run ops.yml -f task=vps-status
gh workflow run ops.yml -f task=giveaway-review
gh workflow run ops.yml -f task=season-start -f title="..." -f days=7 -f prizes="a;b;c"
```

See `.github/workflows/ops.yml` for the full list of tasks.
