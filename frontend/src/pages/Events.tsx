import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Page, Select, Spinner, Stat, Table, type Tone } from "@chestertown/design";
import Pager from "../components/Pager";
import {
  absoluteApiHref, getBlockByIndex, getEventFailureStats, getEventFailures, getIngestedEventStats, getIngestedEvents,
  getIngestorHealth, simulateHuggingFaceEvent,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage, formatDate, shortHash, type Any } from "../lib/types";

const PAGE_SIZE = 20;
const FILTER_KEYS = ["source", "eventType", "status", "verificationStatus"] as const;
type Filters = Record<(typeof FILTER_KEYS)[number], string>;

const STATUS_TONE: Record<string, Tone> = {
  appended: "ok",
  recorded: "ok",
  processing: "info",
  failed: "danger",
  duplicate: "neutral",
};

function filtersFrom(params: URLSearchParams): Filters {
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ""])) as Filters;
}

export default function Events() {
  const canWrite = useAuth().role === "read-write";
  // Filters live in the URL, so "Failed events" and links from elsewhere open them directly.
  const [params, setParams] = useSearchParams();
  const applied = filtersFrom(params);
  const appliedKey = params.toString();
  const [draft, setDraft] = useState<Filters>(applied);
  useEffect(() => setDraft(filtersFrom(new URLSearchParams(appliedKey))), [appliedKey]);

  const [events, setEvents] = useState<Any[]>([]);
  const [failures, setFailures] = useState<Any[]>([]);
  const [stats, setStats] = useState<Any>(null);
  const [failureStats, setFailureStats] = useState<Any>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  const [selected, setSelected] = useState<Any>(null);
  const [linkedBlock, setLinkedBlock] = useState<Any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Simulating needs the optional HTTP event-ingestor; the button only shows where it is deployed.
  const [ingestorAvailable, setIngestorAvailable] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simulation, setSimulation] = useState<Any>(null);

  useEffect(() => {
    // The backend answers this itself and reports whether it can reach the ingestor.
    getIngestorHealth()
      .then((h) => setIngestorAvailable(h?.ingestor?.reachable === true))
      .catch(() => setIngestorAvailable(false));
  }, []);

  const selectEvent = useCallback(async (event: Any) => {
    setSelected(event);
    setLinkedBlock(null);
    if (event.blockIndex === undefined || event.blockIndex === null) return;
    setDetailLoading(true);
    try {
      setLinkedBlock(await getBlockByIndex(Number(event.blockIndex)));
    } catch {
      setLinkedBlock(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const f = filtersFrom(new URLSearchParams(appliedKey));
    const only = (keys: readonly (keyof Filters)[]) => Object.fromEntries(keys.filter((k) => f[k]).map((k) => [k, f[k]]));
    setLoading(true);
    setError("");
    (async () => {
      try {
        const [list, nextStats, failureList, nextFailureStats] = await Promise.all([
          getIngestedEvents(page, PAGE_SIZE, only(FILTER_KEYS)),
          getIngestedEventStats(),
          getEventFailures(1, 5, only(["source", "eventType"])),
          getEventFailureStats(),
        ]);
        if (cancelled) return;
        setEvents(list.data);
        setTotal(list.total);
        setTotalPages(list.totalPages);
        setStats(nextStats);
        setFailures(failureList.data);
        setFailureStats(nextFailureStats);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e, "Failed to load ingested events"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appliedKey, page, reloadTick]);

  function apply(next: Filters) {
    setPage(1);
    setParams(new URLSearchParams(Object.entries(next).filter(([, v]) => v)), { replace: true });
  }

  async function simulateHF() {
    setSimulating(true);
    setError("");
    setSimulation(null);
    try {
      setSimulation(await simulateHuggingFaceEvent());
      apply({ source: "", eventType: "", status: "", verificationStatus: "" });
      setReloadTick((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e, "Failed to simulate Hugging Face event"));
    } finally {
      setSimulating(false);
    }
  }

  const verification = selected?.verificationStatus ?? linkedBlock?.data?.metadata?.verificationStatus ?? "";
  const linkedModel: string = linkedBlock?.data?.modelId ?? "";
  const verified = (stats?.byVerificationStatus?.provider_secret ?? 0) + (stats?.byVerificationStatus?.provider_hmac ?? 0);

  return (
    <Page
      wide
      title="Event ingestion"
      subtitle={`External AI lifecycle events flowing into Ernest${total > 0 ? ` · ${total} events` : ""}`}
      actions={
        <>
          {canWrite && ingestorAvailable && (
            <Button size="sm" onClick={simulateHF} disabled={simulating || loading}>
              {simulating ? "Simulating…" : "Simulate HF"}
            </Button>
          )}
          <Button size="sm" onClick={() => setReloadTick((n) => n + 1)} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </>
      }
    >
      <div className="er-stack-lg">
        {simulation && (
          <Alert tone="ok">
            Hugging Face event accepted as <strong>{simulation.eventType}</strong> · <code>{shortHash(simulation.rawEventHash)}</code>
          </Alert>
        )}

        {stats && (
          <div className="er-grid-4">
            <Stat value={stats.total ?? 0} label="Total events" />
            <Stat value={verified} label="Provider verified" />
            <Stat value={failureStats?.total ?? 0} label="Failures" />
            <Stat value={failureStats?.byFailureKind?.auth_rejected ?? 0} label="Auth rejected" />
            {Object.entries(stats.byStatus ?? {}).slice(0, 3).map(([status, count]) => (
              <Stat key={status} value={String(count)} label={status} />
            ))}
          </div>
        )}

        <Card>
          <form
            className="er-filter-bar"
            onSubmit={(e) => {
              e.preventDefault();
              apply(draft);
            }}
          >
            <Field label="Source" htmlFor="ev-source">
              <Input id="ev-source" placeholder="e.g. huggingface" value={draft.source}
                     onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
            </Field>
            <Field label="Event type" htmlFor="ev-type">
              <Input id="ev-type" placeholder="e.g. model.updated" value={draft.eventType}
                     onChange={(e) => setDraft({ ...draft, eventType: e.target.value })} />
            </Field>
            <Field label="Status" htmlFor="ev-status">
              <Select id="ev-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                <option value="">All statuses</option>
                <option value="appended">appended</option>
                <option value="recorded">recorded (batched)</option>
                <option value="processing">processing</option>
                <option value="failed">failed</option>
                <option value="duplicate">duplicate</option>
              </Select>
            </Field>
            <Field label="Verification" htmlFor="ev-verif">
              <Select id="ev-verif" value={draft.verificationStatus}
                      onChange={(e) => setDraft({ ...draft, verificationStatus: e.target.value })}>
                <option value="">All verification</option>
                <option value="unverified">unverified</option>
                <option value="shared_secret">shared_secret</option>
                <option value="provider_secret">provider_secret</option>
                <option value="provider_hmac">provider_hmac</option>
              </Select>
            </Field>
            <div className="ct-row er-filter-actions">
              <Button type="submit" variant="primary">Apply</Button>
              <Button onClick={() => apply({ source: "", eventType: "", status: "", verificationStatus: "" })}>Clear</Button>
            </div>
          </form>
        </Card>

        {error && <Alert tone="danger">{error}</Alert>}

        <Card
          title="Dead-letter visibility"
          actions={<Link to="/events?status=failed" className="ct-btn ct-btn-outline ct-btn-sm">Failed events</Link>}
        >
          <p className="ct-hint er-gap">Processing failures and auth/provider rejections recorded by the writer.</p>
          {failures.length === 0 ? (
            <Alert tone="ok">No dead-letter events recorded.</Alert>
          ) : (
            <Table>
              <thead>
                <tr><th>Source</th><th>Event type</th><th>Kind</th><th>Auth</th><th>Error</th><th>Failed</th></tr>
              </thead>
              <tbody>
                {failures.map((f, i) => (
                  <tr key={f._id ?? i}>
                    <td>{f.source ?? "—"}</td>
                    <td>{f.eventType ?? "—"}</td>
                    <td>{f.failureKind ?? "processing_failed"}</td>
                    <td>{f.authFailureType ?? "—"}</td>
                    <td className="er-danger er-cell-wide"><code className="er-danger">{f.error}</code></td>
                    <td className="er-nowrap">{formatDate(f.failedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="er-events">
          <div>
            {loading && events.length === 0 ? (
              <Card><Spinner label="Loading events…" /></Card>
            ) : events.length === 0 ? (
              <Card><EmptyState title="No ingested events found">Change the filters, or send events to the ingestor.</EmptyState></Card>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Status</th><th>Source</th><th>Event type</th><th>Verification</th><th>Source event ID</th>
                    <th>Block</th><th>Dupes</th><th>Raw hash</th><th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event._id} className={`er-table-row${selected?._id === event._id ? " ct-selected" : ""}`}
                        tabIndex={0} aria-selected={selected?._id === event._id}
                        onClick={() => void selectEvent(event)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), void selectEvent(event))}>
                      <td><Badge tone={STATUS_TONE[event.status] ?? "neutral"}>{event.status}</Badge></td>
                      <td><strong>{event.source}</strong></td>
                      <td>{event.eventType}</td>
                      <td>{event.verificationStatus ?? "—"}</td>
                      <td className="er-cell-wide"><code>{event.sourceEventId}</code></td>
                      <td>{event.blockIndex !== undefined && event.blockIndex !== null ? `#${event.blockIndex}` : "—"}</td>
                      <td>{event.duplicateCount ?? 0}</td>
                      <td className="er-nowrap"><code>{shortHash(event.rawEventHash, 10)}</code></td>
                      <td className="er-nowrap">{formatDate(event.receivedAt ?? event.appendedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <div className="er-field"><Pager page={page} totalPages={totalPages} onPage={setPage} /></div>
          </div>

          <Card
            title={selected ? "Event detail" : undefined}
            actions={selected && <Badge tone={STATUS_TONE[selected.status] ?? "neutral"}>{selected.status}</Badge>}
          >
            {!selected ? (
              <EmptyState title="No event selected">Select an event to inspect the ingestion record and its hashchain block.</EmptyState>
            ) : (
              <div className="er-stack">
                <dl className="er-facts">
                  <div><dt className="ct-label">Source</dt><dd>{selected.source}</dd></div>
                  <div><dt className="ct-label">Event type</dt><dd>{selected.eventType}</dd></div>
                  <div className="er-span"><dt className="ct-label">Source event ID</dt><dd><code>{selected.sourceEventId}</code></dd></div>
                  <div className="er-span"><dt className="ct-label">Raw event hash</dt><dd><code>{selected.rawEventHash ?? "—"}</code></dd></div>
                  <div><dt className="ct-label">Block index</dt><dd>{selected.blockIndex ?? "—"}</dd></div>
                  <div><dt className="ct-label">Received</dt><dd>{formatDate(selected.receivedAt)}</dd></div>
                  <div className="er-span"><dt className="ct-label">Block hash</dt><dd><code>{selected.blockHash ?? "—"}</code></dd></div>
                  {verification && <div className="er-span"><dt className="ct-label">Verification</dt><dd>{verification}</dd></div>}
                </dl>
                {selected.duplicateCount > 0 && (
                  <Alert tone="info" title="Duplicate handling">
                    {selected.duplicateCount} duplicate {selected.duplicateCount === 1 ? "delivery" : "deliveries"} ignored for original
                    block #{selected.blockIndex}. Last seen {formatDate(selected.duplicateSeenAt)}.
                  </Alert>
                )}
                {detailLoading ? (
                  <Spinner label="Loading linked block…" />
                ) : (
                  linkedBlock && (
                    <div className="er-stack">
                      <div className="er-detail-head">
                        <div>
                          <strong>Linked block #{linkedBlock.index}</strong>
                          <div className="ct-hint">{linkedBlock.data?.type} · {linkedBlock.data?.modelId}</div>
                        </div>
                        {linkedModel && (
                          <div className="ct-row">
                            <Link to={`/models?model=${encodeURIComponent(linkedModel)}`} className="ct-btn ct-btn-outline ct-btn-sm">
                              Provenance
                            </Link>
                            <a className="ct-btn ct-btn-ghost ct-btn-sm" target="_blank" rel="noreferrer"
                               href={absoluteApiHref(`/api/provenances?modelId=${encodeURIComponent(linkedModel)}`)}>
                              JSON
                            </a>
                          </div>
                        )}
                      </div>
                      <pre className="er-pre">{JSON.stringify(linkedBlock.data ?? {}, null, 2)}</pre>
                    </div>
                  )
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
