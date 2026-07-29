import type { Metadata } from "next";
import Link from "next/link";
import styles from "../account-deletion/account-deletion.module.css";

export const metadata: Metadata = {
  title: "OpenJob privacy",
  description: "How OpenJob handles account, task, notification, and diagnostic data.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <Link className={styles.wordmark} href="/">OpenJob</Link>
      <article className={styles.card}>
        <p className={styles.kicker}>Privacy</p>
        <h1>Built for a clear shared list, not surveillance.</h1>
        <p>Effective July 28, 2026.</p>

        <h2>Data OpenJob uses</h2>
        <p>
          OpenJob uses your Google or Apple sign-in through Firebase
          Authentication, your chosen Username, Group membership, Tasks,
          notification capability, and the service records needed to keep those
          features working. Network traffic is encrypted in transit.
        </p>

        <h2>Diagnostics</h2>
        <p>
          If Share diagnostics is enabled, OpenJob may send narrow crash and
          reliability details to Sentry. Diagnostic payloads exclude Task text,
          Group names, Usernames, email addresses, authentication material,
          screenshots, advertising IDs, and permanent device identity. OpenJob
          does not use behavioral analytics, advertising, cross-app tracking, or
          session replay.
        </p>

        <h2>Sharing and sale</h2>
        <p>
          OpenJob does not sell personal data. Data is handled only by OpenJob
          and the service providers needed for authentication, hosting,
          notifications, optional diagnostics, and operating-system quality
          reports. It is not used for advertising or tracking.
        </p>

        <h2>Deletion</h2>
        <p>
          You can permanently delete your User inside OpenJob or from the public
          deletion page. Access ends immediately. Automated cleanup normally
          completes in the same flow and retries for no more than seven days
          during a provider outage. Before deletion is submitted, the web app
          saves a small status receipt in browser localStorage so a reload or
          another tab can safely recover the result. It contains an encrypted,
          User-bound status capability, workflow phase, and an expiry when one
          applies. Those stored values expose no directly readable User identity
          or User content. The receipt is removed after a safe unsubmitted
          recovery or after you acknowledge confirmed completion. OpenJob has no
          approved business or legal retention for deleted User or User-generated
          data.
        </p>
        <p><Link href="/account-deletion">Request account deletion</Link></p>

        <h2>Contact</h2>
        <p>
          Privacy questions can be filed publicly without including personal
          data at <a href="https://github.com/scwlkr/openjob/issues">OpenJob Issues</a>.
          Account deletion itself never requires contacting support.
        </p>
      </article>
    </main>
  );
}
