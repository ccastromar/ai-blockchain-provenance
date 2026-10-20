import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Page, Select, Spinner, Table, type Tone } from "@chestertown/design";
import {
  createAccessToken, listAccessTokens, refreshAuthRole, revokeAccessToken, type AccessTokenRole, type AccessTokenSummary,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/types";

function statusOf(t: AccessTokenSummary): { label: string; tone: Tone } {
  if (t.revokedAt) return { label: "Revoked", tone: "neutral" };
  if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now()) return { label: "Expired", tone: "warn" };
  return { label: "Active", tone: "ok" };
}

export default function Tokens() {
  const auth = useAuth();
  const canWrite = auth.role === "read-write";

  const [tokens, setTokens] = useState<AccessTokenSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");

  const [label, setLabel] = useState("");
  const [role, setRole] = useState<AccessTokenRole>("read-only");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [created, setCreated] = useState("");
  const [copied, setCopied] = useState(false);
  // Revoking cannot be undone: the button asks once more before it acts.
  const [confirmRevoke, setConfirmRevoke] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setListError("");
    try {
      setTokens(await listAccessTokens());
    } catch (e) {
      setListError(errorMessage(e, "Failed to load tokens"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuthRole();
  }, []);
  useEffect(() => {
    if (canWrite) void load();
  }, [canWrite, load]);

  async function create() {
    if (!label.trim()) return;
    setCreating(true);
    setCreateError("");
    setCreated("");
    setCopied(false);
    try {
      const result = await createAccessToken(label.trim(), role, expiresInDays === "" ? undefined : Number(expiresInDays));
      setCreated(result.token);
      setLabel("");
      setExpiresInDays("");
      await load();
    } catch (e) {
      setCreateError(errorMessage(e, "Failed to create token"));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setConfirmRevoke("");
    try {
      await revokeAccessToken(id);
      await load();
    } catch (e) {
      setListError(errorMessage(e, "Failed to revoke token"));
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(created);
      setCopied(true);
    } catch {
      /* clipboard may be unavailable: the value stays on screen to copy by hand */
    }
  }

  return (
    <Page title="Access tokens" subtitle="Named, revocable credentials for teams and auditors">
      {auth.role === "loading" ? (
        <Card><Spinner /></Card>
      ) : !canWrite ? (
        <Card>
          <EmptyState title="Read-write access needed"
                      action={<Link to="/login?redirect=/settings/tokens" className="ct-btn ct-btn-primary">Sign in</Link>}>
            Managing access tokens requires a read-write sign-in.
          </EmptyState>
        </Card>
      ) : (
        <div className="er-stack-lg">
          <Card title="Issue a new token">
            <p className="ct-hint er-gap">
              Give a named, revocable token to a specific team or auditor instead of sharing the standing read/write keys.
              A read-only token is safe to hand to an external auditor for a limited time.
            </p>
            {created && (
              <div className="er-gap">
                <Alert tone="ok" title="Token created — copy it now">
                  <div className="er-endpoint er-token">
                    <code>{created}</code>
                    <Button size="sm" onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
                  </div>
                  <p className="ct-hint">This value is not stored — it cannot be shown again. If it is lost, revoke it and issue a new one.</p>
                </Alert>
              </div>
            )}
            {createError && <div className="er-gap"><Alert tone="danger">{createError}</Alert></div>}
            <form
              className="er-filters"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <div className="er-grow">
                <Field label="Label" htmlFor="tok-label">
                  <Input id="tok-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Auditor - Acme Corp" />
                </Field>
              </div>
              <Field label="Role" htmlFor="tok-role">
                <Select id="tok-role" value={role} onChange={(e) => setRole(e.target.value as AccessTokenRole)}>
                  <option value="read-only">Read-only</option>
                  <option value="read-write">Read-write</option>
                </Select>
              </Field>
              <Field label="Expires in (days)" htmlFor="tok-expiry">
                <Input id="tok-expiry" type="number" min={1} value={expiresInDays} placeholder="Never"
                       onChange={(e) => setExpiresInDays(e.target.value)} />
              </Field>
              <Button type="submit" variant="primary" disabled={creating || !label.trim()}>
                {creating ? "Creating…" : "Create token"}
              </Button>
            </form>
          </Card>

          <Card title="Issued tokens">
            {listError && <div className="er-gap"><Alert tone="danger">{listError}</Alert></div>}
            {loading && tokens.length === 0 ? (
              <Spinner />
            ) : tokens.length === 0 ? (
              <EmptyState title="No tokens issued yet" />
            ) : (
              <Table>
                <thead>
                  <tr><th>Label</th><th>Role</th><th>Status</th><th>Expires</th><th>Last used</th><th aria-label="Actions" /></tr>
                </thead>
                <tbody>
                  {tokens.map((t) => {
                    const status = statusOf(t);
                    return (
                      <tr key={t.id}>
                        <td><strong>{t.label}</strong></td>
                        <td>{t.role}</td>
                        <td><Badge tone={status.tone}>{status.label}</Badge></td>
                        <td>{t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : "Never"}</td>
                        <td className="er-nowrap">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "Never"}</td>
                        <td className="er-actions">
                          {!t.revokedAt &&
                            (confirmRevoke === t.id ? (
                              <div className="ct-row">
                                <Button size="sm" variant="danger" onClick={() => void revoke(t.id)}>Confirm revoke</Button>
                                <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke("")}>Cancel</Button>
                              </div>
                            ) : (
                              <Button size="sm" onClick={() => setConfirmRevoke(t.id)}>Revoke</Button>
                            ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </Page>
  );
}
