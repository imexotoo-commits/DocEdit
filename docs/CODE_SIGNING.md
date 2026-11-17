# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Windows releases of Oakqueill PDF Editor (the installer `Oakqueill-Setup-<version>.exe`, the portable
`Oakqueill-Portable-<version>.exe`, and the program `Oakqueill.exe` they contain) are signed with a certificate issued
to SignPath Foundation, so Windows shows **SignPath Foundation** as the publisher.

## What gets signed

Only files built by this repository's [release workflow](../.github/workflows/release.yml) on GitHub-hosted runners,
from a commit on this repository. Nothing built on a personal computer is signed. Every signing request is tied to
the workflow run and commit that produced it.

## Roles

| Role | Members |
| --- | --- |
| Committers and reviewers | [imexotoo-commits](https://github.com/imexotoo-commits) |
| Approvers (approve each release signing request) | [imexotoo-commits](https://github.com/imexotoo-commits) |

All members use multi-factor authentication for GitHub and SignPath.

## Privacy

Oakqueill PDF Editor does not send any information to other networked systems unless the user asks for it (for
example, by clicking a web link in a document, which opens in the user's own browser). It has no telemetry, no
update check and no account. Documents, saved signatures and settings stay on the user's computer.

## Setting up SignPath (maintainers)

1. The repository must be public. Apply at [signpath.org](https://signpath.org) for the open source programme.
2. In SignPath, connect the GitHub repository as a trusted build system and create the project. Note the
   organization id and project slug.
3. Create two artifact configurations:

   **`app`**: the unpacked program (round 1)

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="Oakqueill.exe">
         <authenticode-sign />
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

   **`installers`**: installer and portable exe (round 2)

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file-set>
         <include path="Oakqueill-Setup-*.exe" />
         <include path="Oakqueill-Portable-*.exe" />
         <for-each>
           <authenticode-sign />
         </for-each>
       </pe-file-set>
     </zip-file>
   </artifact-configuration>
   ```

4. In GitHub, under Settings → Secrets and variables → Actions, add the secret `SIGNPATH_API_TOKEN` and the variables
   `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` and `SIGNPATH_SIGNING_POLICY`. Use `test-signing` until
   the Foundation approves the project, then `release-signing`.
5. Run the workflow from the Actions tab, or push a tag such as `v0.2.0` to get a draft release with the signed files.
