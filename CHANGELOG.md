# Changelog

All notable OpenJob changes are recorded here. Releases follow Semantic Versioning.

## [Unreleased]

### Added

### Changed

### Fixed

### Security

## [0.3.6] - 2026-07-29

### Added

### Changed

### Fixed

- Android account-deletion reauthentication now accepts independently issued Google access tokens after subject and client validation, and large-text diagnostics controls no longer overlap.

### Security
## [0.3.5] - 2026-07-29

### Added

### Changed

### Fixed

- Pending User deletion now survives signed-out relaunches through an encrypted, User-bound status capability that exposes no directly readable identity or content; final confirmation remains until acknowledged.

### Security
## [0.3.4] - 2026-07-28

### Added

- Policy-compliant User deletion on web, iOS, and Android with public request access, provider revocation, bounded encrypted retries, and shared-data cleanup.

### Changed

### Fixed

### Security
## [0.3.3] - 2026-07-18

### Added

### Changed

### Fixed

- The iPhone Task Editor can explicitly clear Due date and keeps Task text fully visible during keyboard transitions.

### Security
## [0.3.2] - 2026-07-18

### Added

### Changed

### Fixed

- The iPhone Task Editor now opens as a zoom-safe half-height sheet with compact touch-first controls and keyboard-aware layout.

### Security
## [0.3.1] - 2026-07-18

### Added

### Changed

### Fixed

- Notification taps reliably select their Group when an installed iPhone or iPad app is launching or resuming.

### Security
## [0.3.0] - 2026-07-18

### Added

- Opt-in Push Notifications for Task assignments and completions triggered by web or CLI Task actions.

### Changed

- Installable PWA notification delivery with per-installation pause, sign-out suppression, and same-User resume.

### Fixed

- Production release smoke preserves pre-existing User Groups while proving pagination.

### Security
## [0.2.0] - 2026-07-17

### Added

- High, Normal, and Low Task Priority across the hosted API, web app, and CLI.
- One synchronized release-version workflow with browser update detection.
## [0.1.1] - 2026-07-17

### Fixed

- Completed the v1 parent acceptance gaps across CLI logout, stale Group recovery, OpenAPI-shaped Username input, and generated API types.

## [0.1.0] - 2026-07-17

### Added

- First complete hosted OpenJob release with shared web, API, and CLI Group, governance, and Task workflows.

[Unreleased]: https://github.com/scwlkr/openjob/compare/v0.3.6...HEAD
[0.3.6]: https://github.com/scwlkr/openjob/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/scwlkr/openjob/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/scwlkr/openjob/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/scwlkr/openjob/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/scwlkr/openjob/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/scwlkr/openjob/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/scwlkr/openjob/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/scwlkr/openjob/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/scwlkr/openjob/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/scwlkr/openjob/releases/tag/v0.1.0
