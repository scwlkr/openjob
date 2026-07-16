import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OpenJobPage } from "../../../app/page";
import "../../../app/globals.css";

const inviteToken = window.location.pathname.match(/^\/invites\/([^/]+)$/)?.[1];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OpenJobPage inviteToken={inviteToken ? decodeURIComponent(inviteToken) : undefined} />
  </StrictMode>,
);
