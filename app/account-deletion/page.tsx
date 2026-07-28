import type { Metadata } from "next";
import { AccountDeletionClient } from "./account-deletion-client";

export const metadata: Metadata = {
  title: "Delete your OpenJob User",
  description: "Request permanent deletion of an OpenJob User and its associated data.",
};

export default function AccountDeletionPage() {
  return <AccountDeletionClient />;
}
