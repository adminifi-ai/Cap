<p align="center">
  <p align="center">
   <img width="150" height="150" src="https://github.com/CapSoftware/Cap/blob/main/apps/desktop/src-tauri/icons/Square310x310Logo.png" alt="Logo">
  </p>
	<h1 align="center"><b>Cap</b></h1>
	<p align="center">
		The open source Loom alternative.
    <br />
    <a href="https://cap.so"><strong>Cap.so »</strong></a>
    <br />
    <br />
    <b>Internal Downloads: </b>
		<a href="https://github.com/adminifi-ai/Cap/actions/workflows/self-build.yml">macOS & Windows builds</a>
    <br />
  </p>
</p>
<br/>

[![Open Bounties](https://img.shields.io/endpoint?url=https%3A%2F%2Fconsole.algora.io%2Fapi%2Fshields%2FCapSoftware%2Fbounties%3Fstatus%3Dopen)](https://console.algora.io/org/CapSoftware/bounties?status=open)

Cap is the open source alternative to Loom. It's a video messaging tool that allows you to record, edit and share videos in seconds.

<img src="https://raw.githubusercontent.com/CapSoftware/Cap/refs/heads/main/apps/web/public/landing-cover.png"/>

# Our Deployment

This fork runs against an internal self-hosted Cap instance deployed on **[Railway](https://railway.com/)**. Desktop builds produced by the workflow below are pre-configured to talk to that instance.

For access to the Railway project, environment variables, deployment issues, or anything else about our internal instance, ping **[@jacogrande](https://github.com/jacogrande)**.

## Downloading the Desktop App

We don't publish signed releases — instead, we build unsigned desktop installers on demand via GitHub Actions and download them as run artifacts.

1. Go to **[Actions → self-build](https://github.com/adminifi-ai/Cap/actions/workflows/self-build.yml)** in this repo.
2. Pick the most recent successful run (or trigger a new one — see below).
3. Scroll to the **Artifacts** section at the bottom of the run page and download the build for your platform:
   - `cap-aarch64-apple-darwin` — Apple Silicon Macs (M1/M2/M3/M4)
   - `cap-x86_64-apple-darwin` — Intel Macs
   - `cap-x86_64-pc-windows-msvc` — Windows (64-bit)
4. Unzip and install: `.dmg` on macOS, `.exe` (NSIS installer) on Windows.

### First-launch warnings (expected)

Because these builds aren't code-signed or notarized:

- **macOS**: right-click the app → Open the first time, or run `xattr -dr com.apple.quarantine /Applications/Cap.app` after installing.
- **Windows**: SmartScreen will warn you — click "More info" → "Run anyway".

## Building the Desktop App

The `self-build` workflow (at [`.github/workflows/self-build.yml`](.github/workflows/self-build.yml)) builds the Tauri desktop app for macOS (arm64 + x86_64) and Windows (x86_64) in parallel. It's triggered manually:

**GitHub UI** → Actions tab → **self-build** → Run workflow → (optionally set a version string) → Run.

Build time is roughly 15–25 minutes on a cold Rust cache, faster afterwards thanks to `setup-rust-cache`.

### Required repo secrets

The workflow depends on three repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Purpose |
|---|---|
| `SELF_HOST_URL` | Base URL of our Railway-hosted Cap instance (no trailing slash). Baked into builds as `VITE_SERVER_URL`. |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater signing key. Required by the bundler even though we don't use auto-update. Generate once with `pnpm tauri signer generate` from `apps/desktop`. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the key above (can be empty). |

If any of these need rotating or you're standing up a new fork, talk to @jacogrande.

# Self Hosting (upstream)

### Quick Start (One Command)

```bash
git clone https://github.com/CapSoftware/Cap.git && cd Cap && docker compose up -d
```

Cap will be running at `http://localhost:3000`. That's it!

> **Note:** Login links appear in the logs (`docker compose logs cap-web`) since email isn't configured by default.

### Other Deployment Options

| Method | Best For |
|--------|----------|
| **Docker Compose** | VPS, home servers, any Docker host |
| **[Railway](https://railway.com/new/template/PwpGcf)** | One-click managed hosting |
| **Coolify** | Self-hosted PaaS (use `docker-compose.coolify.yml`) |

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/PwpGcf)

### Production Configuration

For production, create a `.env` file:

```bash
CAP_URL=https://cap.yourdomain.com
S3_PUBLIC_URL=https://s3.yourdomain.com
```

See our [self-hosting docs](https://cap.so/docs/self-hosting) for full configuration options including email setup, AI features, and SSL.

Cap Desktop can connect to your self-hosted instance via Settings → Cap Server URL.

# Monorepo App Architecture

We use a combination of Rust, React (Next.js), TypeScript, Tauri, Drizzle (ORM), MySQL, TailwindCSS throughout this Turborepo powered monorepo.

> A note about database: The codebase is currently designed to work with MySQL only. MariaDB or other compatible databases might partially work but are not officially supported.

### Apps:

- `desktop`: A [Tauri](https://tauri.app) (Rust) app, using [SolidStart](https://start.solidjs.com) on the frontend.
- `web`: A [Next.js](https://nextjs.org) web app.

### Packages:

- `ui`: A [React](https://reactjs.org) Shared component library.
- `utils`: A [React](https://reactjs.org) Shared utility library.
- `tsconfig`: Shared `tsconfig` configurations used throughout the monorepo.
- `database`: A [React](https://reactjs.org) and [Drizzle ORM](https://orm.drizzle.team/) Shared database library.
- `config`: `eslint` configurations (includes `eslint-config-next`, `eslint-config-prettier` other configs used throughout the monorepo).

### License:
Portions of this software are licensed as follows:

- All code residing in the `cap-camera*` and `scap-*` families of crates is licensed under the MIT License (see [licenses/LICENSE-MIT](https://github.com/CapSoftware/Cap/blob/main/licenses/LICENSE-MIT)).
- All third party components are licensed under the original license provided by the owner of the applicable component
- All other content not mentioned above is available under the AGPLv3 license as defined in [LICENSE](https://github.com/CapSoftware/Cap/blob/main/LICENSE)
  
# Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for more information. This guide is a work in progress, and is updated regularly as the app matures.

## Analytics (Tinybird)

Cap uses [Tinybird](https://www.tinybird.co) to ingest viewer telemetry for dashboards. The Tinybird admin token (`TINYBIRD_ADMIN_TOKEN` or `TINYBIRD_TOKEN`) must be available in your environment. Once the token is present you can:

- Provision the required data sources and materialized views via `pnpm analytics:setup`. This command installs the Tinybird CLI (if needed), runs `tb login` when a `.tinyb` credential file is missing, copies that credential into `scripts/analytics/tinybird`, and finally executes `tb deploy --allow-destructive-operations --wait` from that directory. **It synchronizes the Tinybird workspace to the resources defined in `scripts/analytics/tinybird`, removing any other datasources/pipes in that workspace.**
- Validate that the schema and materialized views match what the app expects via `pnpm analytics:check`.

Both commands target the workspace pointed to by `TINYBIRD_HOST` (defaults to `https://api.tinybird.co`). Make sure you are comfortable with the destructive nature of the deploy step before running `analytics:setup`.
