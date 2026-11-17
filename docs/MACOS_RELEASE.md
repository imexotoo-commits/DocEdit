# macOS release (signing and notarization)

Local and CI test builds are ad-hoc signed (`-c.mac.identity=-`): they run, but Gatekeeper warns on other people's Macs.
A release build is signed with an Apple **Developer ID** and **notarized**, and then opens without a warning.
It needs an Apple Developer Program membership.

## One-time setup
1. Join the Apple Developer Program and, in Xcode (Settings → Accounts → Manage Certificates) or at developer.apple.com,
   create a **Developer ID Application** certificate.
2. In Keychain Access, export that certificate **with its private key** as a `.p12` file and choose a password.
3. Make an app-specific password at appleid.apple.com (Sign-In and Security → App-Specific Passwords).
4. Find your 10-character Team ID (developer.apple.com → Membership).
5. In the GitHub repository: Settings → Secrets and variables → Actions → add these secrets:

| Secret | Value |
|---|---|
| `MAC_CERT_P12_BASE64` | the `.p12`, base64 encoded: `base64 -i cert.p12 | pbcopy` |
| `MAC_CERT_PASSWORD` | the password from step 2 |
| `APPLE_ID` | the Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | from step 3 |
| `APPLE_TEAM_ID` | from step 4 |

## Releasing
Push a tag such as `v0.1.0`, or run the **release-macos** workflow by hand. It builds the universal app, signs it with the
entitlements in `apps/desktop/build/entitlements.mac.plist`, submits it to Apple for notarization (a few minutes), staples
the ticket and verifies the result with `codesign`, `spctl` and `stapler`. The dmg and zip are attached to the run as the
`oakqueill-macos` artifact. The workflow stops at its first step when a secret is missing, so it cannot ship an unsigned build.

Never commit the certificate or the passwords. The workflow has not run yet: expect to adjust it on the first real attempt.
