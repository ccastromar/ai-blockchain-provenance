import { Button } from "@chestertown/design";
import { Link, useLocation } from "react-router";
import { signOutLocally } from "../lib/api";
import { useAuth } from "../lib/auth";

const ROLE_LABEL: Record<string, string> = {
  "read-write": "Full access",
  "read-only": "Read-only",
  anonymous: "Sign in",
};

/// What the current credential may do, linking to the sign-in page. Hidden while Ernest runs
/// with open access (no credential needed).
export default function AccessBadge() {
  const auth = useAuth();
  const { pathname } = useLocation();
  if (auth.role === "loading") return null;
  if (!auth.openAccess && auth.role !== "anonymous") {
    return <Button onClick={() => void signOutLocally()}>Sign out</Button>;
  }
  if (auth.openAccess) return null;
  return (
    <Link
      to={`/login?redirect=${encodeURIComponent(pathname)}`}
      className={`ct-btn ct-btn-sm ${auth.role === "anonymous" ? "ct-btn-primary" : "ct-btn-outline"}`}
      title={auth.label ?? auth.subject ?? ""}
    >
      {ROLE_LABEL[auth.role]}
    </Link>
  );
}
