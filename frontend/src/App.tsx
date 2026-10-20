import { useEffect } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { AppShell, NavTabs, ThemeToggle, chestertownApps, type LinkComponent } from "@chestertown/design";
import AccessBadge from "./components/AccessBadge";
import { refreshAuthRole } from "./lib/api";
import { useAuth } from "./lib/auth";
import { env } from "./env";
import AuthCallback from "./pages/AuthCallback";
import Blocks from "./pages/Blocks";
import Events from "./pages/Events";
import Login from "./pages/Login";
import Models from "./pages/Models";
import Overview from "./pages/Overview";
import Pending from "./pages/Pending";

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
  }, []);
  const sections = auth.role === "read-write" ? [...SECTIONS, DEMO] : SECTIONS;
  return (
    <AppShell
      vertex="assure"
      name="Ernest"
      apps={APPS}
      actions={
        <>
          <AccessBadge />
          <ThemeToggle storageKey="ernest.theme" />
        </>
      }
      nav={<NavTabs label="Ernest sections" items={sections} current={pathname} linkAs={RouterLink} />}
    >
      <Outlet />
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
        {/* Statistics became the Overview at "/"; keep old links and bookmarks working. */}
        <Route path="/stats" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Pending />} />
      </Route>
    </Routes>
  );
}
