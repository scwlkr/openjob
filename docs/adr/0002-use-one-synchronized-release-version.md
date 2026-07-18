# Use one synchronized release version

OpenJob uses the root `package.json` version as the sole release-version authority and synchronizes it across the web app, API contract, CLI package, documentation, Git tag, and GitHub release. Every production deploy is a strict SemVer release prepared and published through a guarded two-phase workflow with curated changelog notes; web, API, and CLI always identify as the same release. The hosted service exposes uncached release metadata so an older browser build can offer a user-controlled refresh without blocking work or refreshing automatically.
