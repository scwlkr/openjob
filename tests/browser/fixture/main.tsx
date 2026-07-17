import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CliAuthClient } from "../../../app/cli-auth/cli-auth-client";
import { OpenJobPage } from "../../../app/page";
import "../../../app/globals.css";

const inviteToken = window.location.pathname.match(/^\/invites\/([^/]+)$/)?.[1];
const search = new URLSearchParams(window.location.search);
const page = window.location.pathname === "/cli-auth"
  ? <CliAuthClient callbackUrl={search.get("callback")} state={search.get("state")} />
  : <OpenJobPage inviteToken={inviteToken ? decodeURIComponent(inviteToken) : undefined} />;

createRoot(document.getElementById("root")!).render(
  <StrictMode>{page}</StrictMode>,
);
