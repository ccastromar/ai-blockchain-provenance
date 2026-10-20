import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, Card, Spinner } from "@chestertown/design";
import { refreshAuthRole } from "../lib/api";
import { completeLogin } from "../lib/oidc";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const started = useRef(false); // the code can be exchanged only once (StrictMode runs effects twice)

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const returnTo = await completeLogin();
        await refreshAuthRole();
        navigate(returnTo, { replace: true });
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [navigate]);

  return (
    <div className="ct-app er-centered">
      <div className="er-narrow">
        <Card title={error ? "Sign-in failed" : undefined}>
          {error ? (
            <>
              <Alert tone="danger">{error}</Alert>
              <p>
                <Link to="/login" className="ct-btn ct-btn-primary">Back to sign in</Link>
              </p>
            </>
          ) : (
            <Spinner label="Completing sign-in…" />
          )}
        </Card>
      </div>
    </div>
  );
}
