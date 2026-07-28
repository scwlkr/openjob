<!-- This file is generated. Edit config/release-privacy-inventory.json, then run npm run privacy:generate. -->

# Release Privacy and Store Preparation

- Inventory schema version: `1.0.0`
- Inventory version: `0.3.4`
- Inventory fingerprint: `sha256:e365251eef2129c650690949ed57ace0f4945160cc388aac02c30f4ba53fd943`
- Generated from: `config/release-privacy-inventory.json`

Preparation status: **not ready for store submission**. Inventory prerequisites are ready; the exact immutable candidate still requires reconciliation and store proof.

This document projects OpenJob-owned behavior separately from third-party declarations. SDK or operating-system claims are evidence, not OpenJob product behavior.

## OpenJob-owned data practices

| ID | Data | Collection | Condition | Linked | Tracking | Shared | Security | Apple mapping | Apple purposes | Play mapping | Play purposes | Processors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `name` | Name | required | account-creation-or-sign-in | Yes | No | No | Encrypted in transit | NSPrivacyCollectedDataTypeName | NSPrivacyCollectedDataTypePurposeAppFunctionality | Personal info > Name | App functionality, Account management | `openjob-api`, `firebase-auth`, `apple-signin`, `google-signin` |
| `email-address` | Email address | required | account-creation-or-sign-in | Yes | No | No | Encrypted in transit | NSPrivacyCollectedDataTypeEmailAddress | NSPrivacyCollectedDataTypePurposeAppFunctionality | Personal info > Email address | App functionality, Account management | `openjob-api`, `firebase-auth`, `apple-signin`, `google-signin` |
| `user-id` | User ID | required | account-creation-or-sign-in | Yes | No | No | Encrypted in transit | NSPrivacyCollectedDataTypeUserID | NSPrivacyCollectedDataTypePurposeAppFunctionality | Personal info > User IDs | App functionality, Account management | `openjob-api`, `firebase-auth` |
| `product-interaction` | Product interaction | required | authenticated-app-functionality | Yes | No | No | Encrypted in transit | NSPrivacyCollectedDataTypeProductInteraction | NSPrivacyCollectedDataTypePurposeAppFunctionality | App activity > App interactions | App functionality | `openjob-api` |
| `crash-data` | Crash data | optional | share-diagnostics-enabled | No | No | No | Encrypted in transit | NSPrivacyCollectedDataTypeCrashData | NSPrivacyCollectedDataTypePurposeAppFunctionality | App info and performance > Crash logs | App functionality, Analytics | `sentry` |
| `performance-data` | Performance data | optional | share-diagnostics-enabled | No | No | No | Encrypted in transit | NSPrivacyCollectedDataTypePerformanceData | NSPrivacyCollectedDataTypePurposeAppFunctionality | App info and performance > Diagnostics | App functionality, Analytics | `sentry` |
| `other-diagnostic-data` | Other diagnostic data | optional | share-diagnostics-enabled | No | No | No | Encrypted in transit | NSPrivacyCollectedDataTypeOtherDiagnosticData | NSPrivacyCollectedDataTypePurposeAppFunctionality | App info and performance > Diagnostics | App functionality, Analytics | `sentry` |
| `downloaded-task-group-content` | Downloaded Task or Group content | not-collected | downloaded-only | No | No | No | Encrypted in transit | Not collected | None | Messages > Other user-generated content — not collected | None | None |
| `device-or-other-ids` | Device or other IDs | not-collected | never-transmitted | No | No | No | Encrypted in transit | Not collected | None | Device or other IDs > Device or other IDs — not collected | None | None |

Required account and app-functionality rows are independent of Share diagnostics. Crash, performance, and other diagnostic rows are optional and apply only while Share diagnostics is enabled. Downloaded Task or Group content remains on-device in the read-only native experience and is not collected.

## Processors

| ID | Processor | Authority | Owner | Role | Native dependencies | Candidate reconciliation |
| --- | --- | --- | --- | --- | --- | --- |
| `openjob-api` | OpenJob API | openjob | OpenJob | app-service | None | Yes |
| `firebase-auth` | Firebase Authentication and Identity Platform | third-party | Google | authentication | None | Yes |
| `apple-signin` | Sign in with Apple | third-party | Apple | authentication | `@invertase/react-native-apple-authentication` | Yes |
| `google-signin` | Google Sign-In | third-party | Google | authentication | `@react-native-google-signin/google-signin` | Yes |
| `sentry` | Sentry | third-party | Functional Software, Inc. | diagnostics | `@sentry/react-native` | Yes |
| `apple-os-quality` | Apple operating-system quality reports | third-party | Apple | operating-system-quality | None | Yes |
| `google-play-quality` | Google Play and Android quality reports | third-party | Google | operating-system-quality | None | Yes |

## Permissions and native configuration

| ID | Permission or capability | Platform | Disposition | Configuration | Processors |
| --- | --- | --- | --- | --- | --- |
| `ios-apple-sign-in-entitlement` | Sign in with Apple entitlement | ios | required | ios-entitlement: com.apple.developer.applesignin=Default | `apple-signin` |
| `ios-uses-apple-sign-in` | Expo Sign in with Apple capability | ios | required | expo-boolean: usesAppleSignIn=true | `apple-signin` |
| `ios-face-id-description` | Face ID usage description | ios | blocked | expo-plugin-boolean: expo-secure-store.faceIDPermission=false | None |
| `android-internet` | Android network access | android | required | android-required-permission: android.permission.INTERNET | `openjob-api`, `firebase-auth`, `sentry` |
| `android-read-external-storage` | Legacy external storage read | android | blocked | android-blocked-permission: android.permission.READ_EXTERNAL_STORAGE | None |
| `android-system-alert-window` | Draw over other apps | android | blocked | android-blocked-permission: android.permission.SYSTEM_ALERT_WINDOW | None |
| `android-write-external-storage` | Legacy external storage write | android | blocked | android-blocked-permission: android.permission.WRITE_EXTERNAL_STORAGE | None |

## Required public URLs and account deletion

| ID | Public resource | URL | Status | Required before submission |
| --- | --- | --- | --- | --- |
| `privacyPolicy` | Privacy policy | https://openjob.dev/privacy | live | Yes |
| `accountDeletion` | Account deletion request | https://openjob.dev/account-deletion | live | Yes |
| `support` | Public support | https://openjob.dev | live | Yes |

Store account deletion is required and currently `implemented` on issue #42. In-app path available: Yes. Public request path available: Yes. Do not save or submit a completed deletion claim until both paths and the public URL are live and proven.

Implemented deletion policy: access ends immediate; retries are bounded to 7 days in a minimal-encrypted-retry-job; retention after completion is none. Sole-Member Groups end; shared membership is remove; final Admin replacement uses longest-tenured-stable-tie-break. Creator Tasks delete; open assignments become unassigned; completed assignments use a deleted-user-marker-without-identity. Linked providers revoke-before-completion.

## Third-party declaration evidence

These rows remain separate from the OpenJob-owned Apple manifest and Play answers:

| ID | Evidence | Processor | Platform | Source | Claims | OpenJob behavior |
| --- | --- | --- | --- | --- | --- | --- |
| `google-signin-apple-sdk-manifest` | GoogleSignIn Apple SDK privacy manifest | `google-signin` | ios | sdk-manifest | Linked Phone Number and Coarse Location for App Functionality; Linked Other Data Types and User ID for App Functionality and Analytics; Linked Device ID and Other Usage Data for Analytics | No |
| `apple-operating-system-quality` | Apple operating-system quality declarations | `apple-os-quality` | ios | operating-system-report | Independent operating-system safety signals are not OpenJob app-level diagnostics | No |
| `google-play-sdk-index` | Google Play SDK Index declarations | `google-play-quality` | android | sdk-index | SDK Index findings remain candidate evidence and do not define OpenJob behavior | No |

## Submission checklist

- [ ] `match-generated-projections` (apple + play): Match store answers to the generated projections and record this inventory fingerprint. Block when: Any generated projection is stale or manually diverged.
- [ ] `verify-public-urls` (apple + play): Verify every required public URL is live at its exact inventory URL. Block when: A required URL is planned, absent, redirected incorrectly, or unavailable.
- [ ] `verify-account-deletion` (apple + play): Verify the implemented in-app and public account-deletion behavior from issue #42. Block when: Account deletion remains pending or differs from the inventory.
- [ ] `reconcile-candidate-evidence` (apple + play): Reconcile exact dependencies, SDK declarations, and captured traffic against the immutable candidate. Block when: Any evidence discrepancy is unexplained.
- [ ] `save-without-premature-claims` (apple + play): Save or submit answers only through the authenticated store surface after all blockers clear. Block when: The candidate, traffic, deletion, URL, or declaration proof is incomplete.

## Candidate reconciliation boundary

Exact dependency inventories, bundled SDK manifests, Play SDK Index entries, and captured provider/API/Sentry traffic can add a discrepancy. They cannot silently rewrite this inventory. Resolve or escalate every discrepancy on #40, and record the final fingerprint with #41.

Evidence and generated reports must exclude credentials, authentication material, personal data, Task content, Group content.
