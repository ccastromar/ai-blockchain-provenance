import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert, Button, Card, Field, Input } from "@chestertown/design";
import { refreshAuthRole, signOutLocally } from "../lib/api";
import { authState, setActiveKey, useAuth, useCan } from "../lib/auth";
import { beginLogin, oidcEnabled } from "../lib/oidc";

const ROLE_LABEL: Record<string, string> = {
  "read-write": "Full access (read-write)",
  "read-only": "Read-only",
  anonymous: "No access",
  loading: "…",
};

export default function Login() {
  const auth = useAuth();
  const canAdmin = useCan("platform.admin");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirectTo = params.get("redirect") || "/";
  const [keyInput, setKeyInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ssoSubmitting, setSsoSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void refreshAuthRole();
  }, []);

  async function signIn() {
    if (!keyInput.trim()) return;
    setSubmitting(true);
    setError("");
    setActiveKey(keyInput.trim());
    await refreshAuthRole();
    setSubmitting(false);
    if (authState.get().role === "anonymous") {
      setError("That key was not recognized. Check it and try again.");
      return;
    }
    setKeyInput("");
    navigate(redirectTo);
  }

  async function signInWithSso() {
    setSsoSubmitting(true);
    setError("");
    try {
      await beginLogin(redirectTo); // redirects away; resolves only on failure
    } catch (e) {
      setError((e as Error).message);
      setSsoSubmitting(false);
    }
  }

  const signedIn = auth.role !== "loading" && auth.role !== "anonymous" && !auth.openAccess;
  return (
    <div className="ct-app er-centered">
      <div className="er-narrow">
        <div className="er-login-head">
          <span className="ct-mark" aria-hidden="true">E</span>
          <h1 className="ct-title">Sign in to Ernest</h1>
          <p className="ct-subtitle">Use single sign-on, or paste the access key or token you were given.</p>
        </div>
        <Card>
          {signedIn ? (
            <div className="er-stack">
              <Alert tone="ok">
                Signed in as <strong>{ROLE_LABEL[auth.role]}</strong>
                {auth.label && <> · {auth.label}</>}
                {auth.subject && <> · <span title="OIDC subject">{auth.subject}</span></>}
              </Alert>
              <div className="ct-row">
                <Link to={redirectTo} className="ct-btn ct-btn-primary">Continue</Link>
                <Button onClick={() => void signOutLocally()}>Sign out</Button>
              </div>
              {canAdmin && <Link to="/settings/tokens">Manage access tokens →</Link>}
            </div>
          ) : (
            <form
              className="er-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void signIn();
              }}
            >
              {error && <Alert tone="danger">{error}</Alert>}
              {oidcEnabled && (
                <>
                  <Button variant="primary" onClick={signInWithSso} disabled={ssoSubmitting}>
                    {ssoSubmitting ? "Redirecting…" : "Sign in with SSO"}
                  </Button>
                  <div className="er-divider">or use a key</div>
                </>
              )}
              <Field label="Access key or token" htmlFor="access-key" hint="Stored only for this browser tab.">
                <Input
                  id="access-key"
                  type="password"
                  autoComplete="off"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="ernest_ro_… or your admin key"
                />
              </Field>
              <Button type="submit" variant={oidcEnabled ? "outline" : "primary"} disabled={submitting || !keyInput.trim()}>
                {submitting ? "Checking…" : "Sign in"}
              </Button>
            </form>
          )}
        </Card>
        <p className="er-back"><Link to="/">← Back to Ernest</Link></p>
      </div>
    </div>
  );
}
