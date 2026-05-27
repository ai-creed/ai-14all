# macOS Signing & Notarization Runbook

How to produce a signed + notarized `ai-14all` build, locally and in CI.

## Apple-side assets (gather once)

1. **Developer ID Application certificate** (`.p12`)
   - In Xcode → Settings → Accounts, or the Apple Developer portal, create a
     "Developer ID Application" certificate.
   - Export it from Keychain Access as a `.p12` with a password.
   - Base64-encode for env injection: `base64 -i DeveloperIDApplication.p12`.
2. **App Store Connect API key** (`.p8`) for notarytool
   - App Store Connect → Users and Access → Integrations → App Store Connect
     API → generate a key with the "Developer" role.
   - Download the `.p8` (one-time download). Note the **Key ID** and **Issuer ID**.
3. **Team ID** — from the Apple Developer membership page.

## Local signed build

1. `cp .env.local.example .env.local`
2. Fill in:
   - `CSC_LINK` = base64 of the `.p12`, `CSC_KEY_PASSWORD` = its password.
   - `APPLE_API_KEY_P8` = contents of the `.p8` (or `APPLE_API_KEY` = path to it).
   - `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`.
3. `pnpm package:mac:signed`
4. Verify:
   ```bash
   APP=$(find release -maxdepth 2 -name '*.app' | head -1)
   codesign --verify --deep --strict --verbose=2 "$APP"
   spctl --assess --type execute --verbose=2 "$APP"
   ```
5. Manually smoke-test the terminal (node-pty) in the signed `.app` — the main
   hardened-runtime risk.

`pnpm package:mac` (without `:signed`) stays unsigned for fast dev iteration.

## CI secrets

Set these GitHub repo secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | base64 of the Developer ID Application `.p12` |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_API_KEY_P8` | full contents of the `.p8` key |
| `APPLE_API_KEY_ID` | the key's Key ID |
| `APPLE_API_ISSUER` | the Issuer ID |
| `APPLE_TEAM_ID` | the Apple Team ID |

The release workflow writes `APPLE_API_KEY_P8` to a temp file, exports the env,
and electron-builder signs + notarizes during `pnpm package:mac`.
