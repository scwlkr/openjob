# Account deletion operations

The Worker retries every non-escalated pending deletion once per 15-minute
scheduled pass. At the seven-day deadline it stops automatic processing and
atomically writes `escalatedAt` on the existing
`v1AccountDeletions/{userId}` job and emits only a generic warning. The job is
the private escalation record: its document ID and `requestId` field are the
exact operator pair. Neither value belongs in logs, URLs, tickets, or public
evidence.

## Complete one escalated job

1. In the Firebase console for `openjob-dev` (Production) or `openjob-nonprod`
   (Preview), open the `v1AccountDeletions` collection and locate a job with an
   `escalatedAt` field. Copy its document ID as `userId` and its `requestId`
   field through the private operator channel.
2. Repair the recorded provider or infrastructure failure. If the job's
   `reauthenticationProviders` field is non-empty, the smallest unavoidable
   account-owner step is to open the deployed `/account-deletion` page, sign in
   to the deleting account, and complete only the provider prompt shown there.
   An operator cannot mint that user's fresh Google or Apple credential.
3. From this repository, run the appropriate interactive command. Do not put
   the pair on the command line.

   ```sh
   npx wrangler secret put ACCOUNT_DELETION_OPERATOR_TARGET
   npx wrangler secret put ACCOUNT_DELETION_OPERATOR_TARGET --env preview
   ```

   At Wrangler's hidden value prompt, enter exactly one compact JSON object:

   ```json
   {"requestId":"del_exact","userId":"user_exact"}
   ```

   The next scheduled pass validates both identifiers, prioritizes that exact
   pair, and still retries every other non-escalated pending job once. A
   malformed or mismatched pair never receives special treatment and cannot
   starve bulk retries. The provider operation and every cleanup write remain
   idempotent.
4. After the next scheduled pass, verify through private consoles that the
   provider authorization is revoked and the User, Username, provider indexes,
   notification data, deletion job, and deletion intent are absent. Do not copy
   identifiers or content into public evidence.
5. Immediately remove the temporary target, whether the retry succeeded or
   failed:

   ```sh
   npx wrangler secret delete ACCOUNT_DELETION_OPERATOR_TARGET
   npx wrangler secret delete ACCOUNT_DELETION_OPERATOR_TARGET --env preview
   ```

The exported `retryAccountDeletion(userId, requestId)` function is the same
strict pair fence for privileged Worker-side tests and tooling. It is not a
public HTTP route. Never mark a provider checkpoint complete from an operator
assertion alone; use the supported provider revocation path and verify its
result.
