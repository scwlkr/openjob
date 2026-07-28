import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OpenJobPage } from "../../../app/page";
import { AccountDeletionClient } from "../../../app/account-deletion/account-deletion-client";
import "../../../app/globals.css";

const inviteToken = window.location.pathname.match(/^\/invites\/([^/]+)$/)?.[1];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.pathname === "/account-deletion" ? (
      <AccountDeletionClient />
    ) : (
      <OpenJobPage inviteToken={inviteToken ? decodeURIComponent(inviteToken) : undefined} />
    )}
  </StrictMode>,
);
