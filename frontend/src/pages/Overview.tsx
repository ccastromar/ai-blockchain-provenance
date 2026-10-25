import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Alert, Badge, Button, Card, Checkbox, Page, Spinner, Stat, type Tone } from "@chestertown/design";
import { absoluteApiHref, anchorNow, getAnchorStatus, getChainStats, getHealth, verifyChain, type HealthStatus } from "../lib/api";
import { useCan } from "../lib/auth";

// The stats endpoints are untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const SUBSYSTEMS = [
  { key: "mongo", label: "MongoDB" },
  { key: "indexer", label: "Chain indexer" },
  { key: "integrity", label: "Integrity check" },
  { key: "cron", label: "Anchor jobs" },
  { key: "ethereum", label: "Ethereum RPC" },
] as const;

function subsystemTone(status?: string): Tone {
  if (status === "ok") return "ok";
  if (status === "error" || status === "degraded") return "danger";
  if (status === "catching_up") return "warn";
  return "neutral";
}

export default function Overview() {
  const canWrite = useCan("platform.admin");
  const [stats, setStats] = useState<Any>(null);
  const [verification, setVerification] = useState<Any>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [anchorStatus, setAnchorStatus] = useState<Any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [now, setNow] = useState(new Date());
  const [anchoring, setAnchoring] = useState(false);
  const [anchorMessage, setAnchorMessage] = useState("");
  const [anchorError, setAnchorError] = useState("");

  const loadStats = useCallback(async () => {
    try {
      const [s, v, h, a] = await Promise.all([
        getChainStats(),
        verifyChain(),
        getHealth(),
        getAnchorStatus().catch(() => null),
      ]);
      setStats(s);
      setVerification(v);
      setHealth(h);
      setAnchorStatus(a);
      setLoadError("");
    } catch (e: Any) {
      // Keep the last figures on screen and say why they are not current.
      setLoadError(
        e?.response?.status === 401 || e?.response?.status === 403
          ? "Ernest needs a credential to show this. Sign in to see the chain."
          : `Could not reach Ernest (${e?.message ?? "unknown error"}).`,
      );
    } finally {
      setLoading(false);
      setNow(new Date());
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadStats, 10_000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadStats]);

  async function forceAnchor() {
    setAnchoring(true);
    setAnchorMessage("");
    setAnchorError("");
    try {
      const result = await anchorNow();
      setAnchorMessage(
        result.provider === "ots"
          ? `OpenTimestamps anchor submitted (pending Bitcoin aggregation), blocks 0..${result.lastBlockIndex}.`
          : `Anchored blocks 0..${result.lastBlockIndex ?? "?"} — tx ${(result.txHash ?? "").slice(0, 14)}…`,
      );
      await loadStats();
    } catch (e: Any) {
      setAnchorError(e?.response?.data?.message ?? e.message ?? "Anchoring failed.");
    } finally {
      setAnchoring(false);
    }
  }

  const anchor = stats?.lastAnchor;
  const isOts = anchor?.provider === "ots";
  // Blocks still to append before the automatic anchor fires (null when anchoring is off).
  const blocksToNextAnchor = (() => {
    const n = anchorStatus?.everyNBlocks;
    if (!anchorStatus?.configured || !n || !stats) return null;
    const since = (stats.lastBlockIndex ?? 0) - (anchor?.lastBlockIndex ?? -1);
    return Math.max(n - since, 0);
  })();
  const anchorKind = (mode?: string) => (mode === "ots" ? "OpenTimestamps · Bitcoin" : "EVM contract");
  const valid = verification?.isValid === true;
  // Only a verification that ran and failed says the chain is compromised; no result says nothing.
  const invalid = verification?.isValid === false;

  return (
    <Page
      wide
      title="Overview"
      subtitle="Chain, anchoring and service health"
      actions={
        <>
          <Button size="sm" onClick={() => void loadStats()}>Refresh</Button>
          <Checkbox label="Auto (10 s)" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          <span className="ct-hint er-clock">Updated {format(now, "HH:mm:ss")}</span>
        </>
      }
    >
      {loadError && (
        <div className="er-gap">
          <Alert tone="danger">{loadError}</Alert>
        </div>
      )}
      {loading ? (
        <Spinner label="Loading statistics…" />
      ) : !stats ? null : (
        <div className="er-stack-lg">
          <div className="er-grid-3">
            <Stat value={stats?.totalBlocks ?? 0} label="Total blocks" hint="Including genesis block" />
            <Stat value={stats?.totalModels ?? 0} label="AI models" hint="Registered in the chain" />
            <Stat value={stats?.lastBlockIndex ?? 0} label="Last block index" hint="Current chain height" />
          </div>

          <Card
            title="Chain integrity"
            actions={
              stats?.lastBlockTimestamp && (
                <span className="ct-hint">Last block {format(new Date(stats.lastBlockTimestamp), "dd MMM HH:mm")}</span>
              )
            }
          >
            <Badge tone={valid ? "ok" : invalid ? "danger" : "neutral"} dot>
              {valid
                ? "Valid — the chain is intact"
                : invalid
                  ? "Invalid — chain integrity compromised"
                  : "Unknown — no verification result"}
            </Badge>
            {stats?.lastBlockHash && (
              <div className="er-field">
                <div className="ct-label">Last block hash</div>
                <div className="er-mono-box">{stats.lastBlockHash}</div>
              </div>
            )}
            {verification?.errors?.length > 0 && (
              <div className="er-field">
                <Alert tone="warn" title="Verification errors">
                  <ul className="er-bullets">
                    {verification.errors.map((err: string) => (
                      <li key={err}>{err}</li>
                    ))}
                  </ul>
                </Alert>
              </div>
            )}
          </Card>

          {health && (
            <Card title="Service health" actions={<Badge tone={health.status === "ok" ? "ok" : "danger"}>{health.status}</Badge>}>
              <div className="er-grid-5">
                {SUBSYSTEMS.map((svc) => {
                  const s = (health.subsystems as Record<string, Any> | undefined)?.[svc.key];
                  return (
                    <div key={svc.key} className="er-tile">
                      <div className="er-tile-head">
                        <span>{svc.label}</span>
                        <Badge tone={subsystemTone(s?.status)} dot>
                          {s ? (s.status === "not_configured" ? "not configured" : s.status.replace("_", " ")) : "no data"}
                        </Badge>
                      </div>
                      {s?.detail && <div className="ct-hint">{s.detail}</div>}
                      {svc.key === "indexer" && s?.indexedUpTo != null && (
                        <div className="ct-hint">indexed up to #{s.indexedUpTo}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card title="Chain metrics">
            <dl className="er-dl">
              <div>
                <dt>Average events per model</dt>
                <dd>{stats?.totalBlocks > 1 ? Math.round(stats.totalBlocks / (stats.totalModels || 1)) : "N/A"}</dd>
              </div>
              <div>
                <dt>Chain growth</dt>
                <dd>{stats?.totalBlocks > 1 ? "Active" : "Starting"}</dd>
              </div>
              <div>
                <dt>Verification</dt>
                <dd className={valid ? "er-ok" : invalid ? "er-danger" : undefined}>
                  {valid ? "Passing" : invalid ? "Failing" : "Unknown"}
                </dd>
              </div>
            </dl>
          </Card>

          <Card
            title={
              <>
                Blockchain anchor{" "}
                {(anchor || anchorStatus?.configured) && (
                  <span className="ct-hint">({anchor ? anchorKind(anchor.provider) : anchorKind(anchorStatus.mode)})</span>
                )}
              </>
            }
            actions={
              <Button
                size="sm"
                onClick={forceAnchor}
                disabled={anchoring || !canWrite}
                title={
                  canWrite
                    ? "Force an anchor now, ignoring the block-count threshold"
                    : "Read-only access — anchoring requires a read-write key"
                }
              >
                {anchoring ? "Anchoring…" : "Anchor now"}
              </Button>
            }
          >
            {anchorMessage && <div className="er-gap"><Alert tone="ok">{anchorMessage}</Alert></div>}
            {anchorError && <div className="er-gap"><Alert tone="danger">{anchorError}</Alert></div>}
            {anchor ? (
              <dl className="er-facts">
                {(isOts
                  ? [
                      ["Last block index", anchor.lastBlockIndex],
                      ["Anchor time", new Date(anchor.anchoredAt).toLocaleString()],
                      ["Status", anchor.status],
                      ["Bitcoin block", anchor.bitcoinBlockHeight ?? "pending aggregation"],
                    ]
                  : [
                      ["Block number", anchor.blockNumber],
                      ["Last block index", anchor.lastBlockIndex],
                      ["Anchor time", new Date(anchor.anchoredAt).toLocaleString()],
                      ["Chain ID", anchor.chainId],
                      ["Status", anchor.status],
                    ]
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="ct-label">{label}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
                {blocksToNextAnchor != null && (
                  <div className="er-span">
                    <span className="ct-hint">
                      Next automatic anchor in {blocksToNextAnchor} blocks (every {anchorStatus.everyNBlocks}).
                    </span>
                  </div>
                )}
                <div className="er-span">
                  <dt className="ct-label">Merkle root</dt>
                  <dd className="er-mono-box">{anchor.merkleRoot}</dd>
                </div>
                {isOts ? (
                  <div className="er-span">
                    <dt className="ct-label">OpenTimestamps proof</dt>
                    <dd>
                      <a href={absoluteApiHref(anchor.otsProofUrl)}>Download .ots proof</a> and{" "}
                      <a href={absoluteApiHref(anchor.otsRawUrl)}>root file</a> (both needed).
                      <div className="ct-hint">
                        Verify offline:{" "}
                        <code>
                          ots verify -f ernest-anchor-{anchor.otsProofUrl.split("/")[3]} ernest-anchor-
                          {anchor.otsProofUrl.split("/")[3]}.ots
                        </code>
                      </div>
                    </dd>
                  </div>
                ) : (
                  anchor.txHash && (
                    <div className="er-span">
                      <dt className="ct-label">Tx hash</dt>
                      <dd>
                        <a href={anchor.etherscanUrl} target="_blank" rel="noopener noreferrer" className="er-mono">
                          {anchor.txHash}
                        </a>
                      </dd>
                    </div>
                  )
                )}
              </dl>
            ) : (
              <p className="ct-hint er-empty-line">
                {anchorStatus && !anchorStatus.configured
                  ? "No anchor yet: anchoring is disabled on this server."
                  : anchorStatus
                    ? `No anchor yet. The first one is made automatically after ${anchorStatus.everyNBlocks} blocks${
                        blocksToNextAnchor != null ? ` (${blocksToNextAnchor} to go)` : ""
                      }, or now with “Anchor now”.`
                    : "No anchor yet. Anchor the chain state to an EVM contract or OpenTimestamps (Bitcoin)."}
              </p>
            )}
          </Card>
        </div>
      )}
    </Page>
  );
}
