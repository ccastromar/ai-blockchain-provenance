import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "@chestertown/design/styles.css";
import "./styles.css";
import App from "./App";
import { reportIdpSessionIfFramed } from "./lib/oidc";

if (!reportIdpSessionIfFramed())
  createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
