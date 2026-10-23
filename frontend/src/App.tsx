import { useEffect } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { AppShell, Button, Card, Identity, NavTabs, Page, ThemeToggle, chestertownApps, type LinkComponent } from "@chestertown/design";
import AccessBadge from "./components/AccessBadge";
import Audit from "./pages/Audit";
import Connectors from "./pages/Connectors";
import Demo from "./pages/Demo";
import VerifyReceipt from "./pages/VerifyReceipt";
import { refreshAuthRole } from "./lib/api";
import { getActiveCredential, useAuth } from "./lib/auth";
import { beginLogin, oidcEnabled, trySilentLogin } from "./lib/oidc";
import { env } from "./env";
import AuthCallback from "./pages/AuthCallback";
import Blocks from "./pages/Blocks";
import Events from "./pages/Events";
import Login from "./pages/Login";
import Models from "./pages/Models";
import Overview from "./pages/Overview";
import NotFound from "./pages/NotFound";
import Tokens from "./pages/Tokens";

const APPS = chestertownApps({
  operate: env.PUBLIC_AOS_URL,
  govern: env.PUBLIC_PRUDENCE_URL,
  assure: env.PUBLIC_ERNEST_URL,
});

// One navigation for every page: the same destinations are always shown, the current one is
// highlighted. Page-specific actions (Refresh, Simulate…) stay in each page's own header.
const SECTIONS = [
  { href: "/", label: "Overview" },
  { href: "/models", label: "Models" },
  { href: "/blocks", label: "Blocks" },
  { href: "/events", label: "Events" },
  { href: "/connectors", label: "Connectors" },
  { href: "/auditor", label: "Audit" },
  { href: "/verify-receipt", label: "Verify receipt" },
  { href: "/settings/tokens", label: "Tokens" },
];
// Demo (manual evidence entry) writes to the chain: only offered to read-write users, so
// visitors of the public portal see real evidence only.
const DEMO = { href: "/demo", label: "Demo" };

const RouterLink: LinkComponent = ({ href, ...rest }) => <Link to={href} {...rest} />;

function Shell() {
  const { pathname } = useLocation();
  const auth = useAuth();
  useEffect(() => {
    void refreshAuthRole();
    if (!getActiveCredential()) {
      void trySilentLogin(window.location.pathname + window.location.search + window.location.hash).catch(() => {
        // Public browsing remains available if the identity provider is unreachable.
      });
    }
  }, []);
  // Signed in, but the identity provider gave no role Ernest maps: say so instead of showing empty pages.
  const noRole = !auth.openAccess && auth.role === "anonymous" && !!getActiveCredential();
  // No credential and no open access: the whole UI stays closed until the user signs in.
  const signedOut = !auth.openAccess && auth.role === "anonymous" && !noRole;
  const sections = auth.role === "read-write" ? [...SECTIONS, DEMO] : SECTIONS;
  return (
    <AppShell
      vertex="assure"
      name="Ernest"
      apps={APPS}
      actions={
        <>
          {!auth.openAccess && auth.role !== "loading" && (auth.role !== "anonymous" || noRole) && (
            <Identity
              name={auth.label ?? auth.subject ?? auth.role}
              detail={noRole ? "No Ernest role" : `Access: ${auth.role}`}
            />
          )}
          <AccessBadge />
          <ThemeToggle storageKey="ernest.theme" />
        </>
      }
      nav={noRole || signedOut || auth.role === "loading" ? undefined : <NavTabs label="Ernest sections" items={sections} current={pathname} linkAs={RouterLink} />}
    >
      {auth.role === "loading" ? null : signedOut ? (
        <Page>
          <Card style={{ maxWidth: 420, margin: "var(--sp-12) auto", textAlign: "center" }}>
            <h1 className="ct-title">Sign in to Ernest</h1>
            <p className="sub">Evidence is a controlled resource — sign in with your identity provider.</p>
            {oidcEnabled ? (
              <Button variant="primary" onClick={() => void beginLogin(pathname)}>
                Sign in with SSO
              </Button>
            ) : (
              <Link to={`/login?redirect=${encodeURIComponent(pathname)}`} className="ct-btn ct-btn-primary">
                Sign in
              </Link>
            )}
          </Card>
        </Page>
      ) : noRole ? (
        <Page>
          <Card style={{ maxWidth: 480, margin: "var(--sp-12) auto", textAlign: "center" }}>
            <h1 className="ct-title">No access to Ernest</h1>
            <p className="sub">
              {auth.label ?? auth.subject ?? "Your account"} is signed in but has no Ernest role. Ask an administrator to assign one,
              then sign in again.
            </p>
          </Card>
        </Page>
      ) : (
        <Outlet />
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Sign-in screens stand alone: there is nowhere to navigate before you are in. */}
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<Shell />}>
        <Route index element={<Overview />} />
        <Route path="/models" element={<Models />} />
        <Route path="/blocks" element={<Blocks />} />
        <Route path="/events" element={<Events />} />
        <Route path="/connectors" element={<Connectors />} />
        <Route path="/auditor" element={<Audit />} />
        <Route path="/verify-receipt" element={<VerifyReceipt />} />
        <Route path="/settings/tokens" element={<Tokens />} />
        <Route path="/demo" element={<Demo />} />
        {/* Statistics became the Overview at "/"; keep old links and bookmarks working. */}
        <Route path="/stats" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
