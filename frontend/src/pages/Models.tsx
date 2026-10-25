import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import {
  Alert, Badge, Button, Card, EmptyState, Field, Input, Page, RiskBadge, Select, Spinner, type RiskTier, type Tone,
} from "@chestertown/design";
import Pager from "../components/Pager";
import {
  exportProvenance, exportProvenanceCycloneDx, getModelById, getModelIntegrity, getModels, getProvenance, patchModel,
  type ModelKind, type ModelSort, type ModelStatus, type ProvenanceFilter,
} from "../lib/api";
import { useCan } from "../lib/auth";
import { errorMessage, type Any } from "../lib/types";
import { env } from "../env";

const PAGE_SIZE = 10;
type Kind = Exclude<ModelKind, "all">;
type EventType = NonNullable<ProvenanceFilter["type"]>;

const SORTS: { value: ModelSort; label: string }[] = [
  { value: "recent", label: "Newest first" },
  { value: "activity", label: "Latest activity" },
  { value: "name", label: "Name" },
  { value: "risk", label: "Risk (highest first)" },
  { value: "governed", label: "Governed by Prudence first" },
];
const STATUS_TONE: Record<string, Tone> = { active: "ok", deprecated: "warn", archived: "neutral" };
const STATUSES: ModelStatus[] = ["active", "deprecated", "archived"];

// A system governed elsewhere (Prudence's registry) keeps its lifecycle there: Ernest only
// holds its evidence, so its status is read-only here (the backend refuses changes too).
const governedBy = (m: Any): string | undefined =>
  m?.governance?.systemOfRecord ??
  (m?.metadata?.kind === "governance-register" ? m?.metadata?.systemOfRecord : undefined);

// Deep link into the system of record: Prudence opens the AI system in its registry, or the
// tab of one of its registers (incidents, reviews, attestations).
const REGISTER_TABS: Record<string, string> = {
  "prudence-incidents": "incidents",
  "prudence-reviews": "approvals",
  "prudence-attestations": "attestations",
};
function ownerUrl(owner: string, m?: Any) {
  if (owner !== "prudence") return undefined;
  const base = (env.PUBLIC_PRUDENCE_URL || "http://localhost:5200").replace(/\/+$/, "");
  if (!m) return base;
  if (m.metadata?.kind === "governance-register") {
    const tab = REGISTER_TABS[m.modelId];
    return tab ? `${base}/?tab=${tab}` : base;
  }
  const id = m.governance?.aiSystemId ?? m.modelId;
  return `${base}/?tab=registry&system=${encodeURIComponent(id)}`;
}
// An execution recorded by AOS links back to that run in the AOS console (its task id is the
// event's traceId).
function aosRunUrl(block: Any) {
  const md = block?.metadata;
  if (md?.producer !== "aos-agentic-orchestration-system" || !md?.traceId) return undefined;
  const base = (env.PUBLIC_AOS_URL || "http://localhost:5173").replace(/\/+$/, "");
  return `${base}/?taskId=${encodeURIComponent(md.traceId)}`;
}
const ownerLabel = (owner: string) => (owner === "prudence" ? "Prudence" : owner);
const integrityValid = (result: Any) => (result?.valid ?? result?.isValid) === true;
// The name shown first: a governed system's own name, otherwise the model id.
const primaryName = (m: Any) => (governedBy(m) && m.name && m.name !== m.modelId ? m.name : m.modelId);

export default function Models() {
  const canWrite = useCan("evidence.write");
  // Kind, order and the open model live in the URL: shareable, survive a reload, and let
  // Prudence and AOS link straight to an AI system's evidence (/models?model=<id>).
  const [params, setParams] = useSearchParams();
  const kind: Kind = params.get("kind") === "records" ? "records" : "models";
  const sortParam = params.get("sort") as ModelSort | null;
  const sort: ModelSort = sortParam && SORTS.some((s) => s.value === sortParam) ? sortParam : "recent";
  const selectedId = params.get("model") ?? "";

  const [models, setModels] = useState<Any[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState("");

  const [model, setModel] = useState<Any>(null);
  const [provenance, setProvenance] = useState<Any>(null);
  const [integrity, setIntegrity] = useState<Any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingIntegrity, setLoadingIntegrity] = useState(false);
  const [patchingStatus, setPatchingStatus] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [filterType, setFilterType] = useState<"" | EventType>("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filtering, setFiltering] = useState(false);
  const filtersActive = !!(filterType || filterFrom || filterTo);

  const updateParams = useCallback(
    (changes: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    setListError("");
    getModels(page, PAGE_SIZE, sort, kind)
      .then((res) => {
        if (cancelled) return;
        setModels(res.data);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      })
      .catch((e) => !cancelled && setListError(errorMessage(e, "Failed to load models")))
      .finally(() => !cancelled && setLoadingList(false));
    return () => {
      cancelled = true;
    };
  }, [page, sort, kind]);

  useEffect(() => {
    setModel(null);
    setProvenance(null);
    setIntegrity(null);
    setFilterType("");
    setFilterFrom("");
    setFilterTo("");
    setDetailError("");
    if (!selectedId) return;
    let cancelled = false;
    setLoadingDetail(true);
    Promise.all([getModelById(selectedId), getProvenance(selectedId)])
      .then(([m, p]) => {
        if (cancelled) return;
        setModel(m);
        setProvenance(p);
      })
      .catch((e) => !cancelled && setDetailError(errorMessage(e, "Failed to load model")))
      .finally(() => !cancelled && setLoadingDetail(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  /// Changing kind or order restarts at page 1 and closes the open model.
  function setView(next: { kind?: Kind; sort?: ModelSort }) {
    setPage(1);
    updateParams({ kind: next.kind ?? kind, sort: next.sort ?? sort, model: null });
  }

  function provenanceFilters(type = filterType, from = filterFrom, to = filterTo): ProvenanceFilter {
    return { ...(type ? { type } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) };
  }

  async function applyFilters(filters = provenanceFilters()) {
    if (!selectedId) return;
    setFiltering(true);
    try {
      setProvenance(await getProvenance(selectedId, filters));
    } catch (e) {
      setDetailError(errorMessage(e, "Failed to load provenance"));
    } finally {
      setFiltering(false);
    }
  }

  function clearFilters() {
    setFilterType("");
    setFilterFrom("");
    setFilterTo("");
    void applyFilters({});
  }

  async function changeStatus(status: ModelStatus) {
    if (!selectedId) return;
    setPatchingStatus(true);
    try {
      const updated = await patchModel(selectedId, status);
      setModels((list) => list.map((m) => (m.modelId === selectedId ? { ...m, status } : m)));
      setModel((m: Any) => (m ? { ...m, status: updated?.status ?? status } : m));
    } catch (e) {
      setDetailError(errorMessage(e, "Failed to update status"));
    } finally {
      setPatchingStatus(false);
    }
  }

  async function checkIntegrity() {
    if (!selectedId) return;
    setLoadingIntegrity(true);
    setIntegrity(null);
    try {
      setIntegrity(await getModelIntegrity(selectedId));
    } catch (e) {
      setDetailError(errorMessage(e, "Failed to check integrity"));
    } finally {
      setLoadingIntegrity(false);
    }
  }

  const owner = model ? governedBy(model) : undefined;

  return (
    <Page wide title="AI models" subtitle={total > 0 ? `${total} in the chain` : "Models and AI systems with evidence in Ernest"}>
      <div className="er-master">
        <div className="er-master-list">
          <div className="er-segmented" role="group" aria-label="Which entries">
            {([
              ["models", "AI systems & models"],
              ["records", "Prudence records"],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={kind === id} onClick={() => setView({ kind: id })}>
                {label}
              </button>
            ))}
          </div>
          <label className="er-inline">
            Sort
            <Select value={sort} onChange={(e) => setView({ sort: e.target.value as ModelSort })}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
          </label>
          {kind === "records" && (
            <p className="ct-hint">
              Governance registers kept by Prudence: incident events, review decisions and attestations. Each is a
              stream of evidence records, not an AI model.
            </p>
          )}
          {listError && <Alert tone="danger">{listError}</Alert>}

          <div className="er-list">
            {loadingList ? (
              <div className="er-list-empty">Loading…</div>
            ) : models.length === 0 ? (
              <div className="er-list-empty">{kind === "records" ? "No governance registers yet." : "No models registered yet."}</div>
            ) : (
              models.map((m) => {
                const by = governedBy(m);
                return (
                  <button key={m.modelId} type="button" className="er-list-item"
                          aria-current={selectedId === m.modelId ? "true" : undefined}
                          onClick={() => updateParams({ model: m.modelId })}>
                    <div className="er-list-title">
                      <span>{primaryName(m)}</span>
                      {m.status && m.status !== "active" && <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{m.status}</Badge>}
                    </div>
                    <div className="er-list-sub">
                      <span>
                        {by ? m.modelId : m.name || "No name"}
                        {m.version && m.version !== "external" ? ` · v${m.version}` : ""}
                      </span>
                      {by && <Badge tone="accent">{ownerLabel(by)}</Badge>}
                      {m.governance?.riskTier && <RiskBadge tier={m.governance.riskTier as RiskTier} />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <Pager page={page} totalPages={totalPages} onPage={setPage} />
        </div>

        <div>
          {loadingDetail ? (
            <Card><Spinner /></Card>
          ) : detailError && !model ? (
            <Alert tone="danger">{detailError}</Alert>
          ) : model ? (
            <div className="er-stack">
              {detailError && <Alert tone="danger">{detailError}</Alert>}
              <div className="er-detail-head">
                <div>
                  <div className="ct-label">Model detail</div>
                  <div className="er-detail-id">{primaryName(model)}</div>
                  {primaryName(model) !== model.modelId && <code>{model.modelId}</code>}
                  {owner && (
                    <div className="er-list-sub">
                      Governed by{" "}
                      {ownerUrl(owner, model) ? (
                        <a href={ownerUrl(owner, model)} target="_blank" rel="noopener noreferrer">{ownerLabel(owner)}</a>
                      ) : (
                        ownerLabel(owner)
                      )}
                      {model.governance?.riskTier && <RiskBadge tier={model.governance.riskTier as RiskTier} />}
                    </div>
                  )}
                </div>
                {owner ? (
                  <span className="ct-hint" title="Its lifecycle (approval, suspension, retirement) is managed by its system of record">
                    Managed in {ownerLabel(owner)}
                  </span>
                ) : (
                  <div className="ct-row">
                    <Badge tone={STATUS_TONE[model.status ?? "active"] ?? "ok"}>{model.status ?? "active"}</Badge>
                    <Select
                      aria-label="Change status"
                      value={model.status ?? "active"}
                      disabled={patchingStatus || !canWrite}
                      title={canWrite ? "Change the model's status" : "Read-only access — changing model status needs the evidence.write function"}
                      onChange={(e) => void changeStatus(e.target.value as ModelStatus)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>

              <Card>
                <dl className="er-facts">
                  <div>
                    <dt className="ct-label">Name</dt>
                    <dd>{model.name}</dd>
                  </div>
                  <div>
                    <dt className="ct-label">Version</dt>
                    <dd>{model.version}</dd>
                  </div>
                  {([
                    ["Parameters", model.parameters],
                    ["Metrics", model.metrics],
                    ["Metadata", model.metadata],
                  ] as const).map(([label, data]) =>
                    data && Object.keys(data).length ? (
                      <div key={label} className="er-span">
                        <dt className="ct-label">{label}</dt>
                        <dd><pre className="er-pre">{JSON.stringify(data, null, 2)}</pre></dd>
                      </div>
                    ) : null,
                  )}
                </dl>
              </Card>

              <Card
                title="Model integrity"
                actions={
                  <Button size="sm" onClick={checkIntegrity} disabled={loadingIntegrity}>
                    {loadingIntegrity ? "Checking…" : "Check integrity"}
                  </Button>
                }
              >
                {integrity ? (
                  <>
                    <Badge tone={integrityValid(integrity) ? "ok" : "danger"} dot>
                      {integrityValid(integrity) ? "All blocks are valid" : "Integrity issues found"}
                    </Badge>
                    {integrity.errors?.length > 0 && (
                      <ul className="er-bullets er-danger">
                        {integrity.errors.map((err: string) => <li key={err}>{err}</li>)}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="ct-hint">Verify only this model's blocks without scanning the full chain.</p>
                )}
              </Card>

              {provenance && (
                <Card
                  title={
                    <>
                      Provenance · {provenance.totalBlocks} blocks {filtersActive && <Badge tone="accent">filtered</Badge>}
                    </>
                  }
                  actions={
                    <>
                      <a className="ct-btn ct-btn-outline ct-btn-sm" href={exportProvenance(selectedId)} target="_blank"
                         rel="noopener noreferrer" title="Download the full provenance as JSON">JSON</a>
                      <a className="ct-btn ct-btn-outline ct-btn-sm" href={exportProvenanceCycloneDx(selectedId)} target="_blank"
                         rel="noopener noreferrer" title="Download as CycloneDX 1.6 AI/ML-BOM">ML-BOM</a>
                    </>
                  }
                >
                  <form
                    className="er-filters"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void applyFilters();
                    }}
                  >
                    <Field label="Event type" htmlFor="pv-type">
                      <Select id="pv-type" value={filterType} onChange={(e) => setFilterType(e.target.value as "" | EventType)}>
                        <option value="">All</option>
                        <option value="model_registration">Registration</option>
                        <option value="inference">Inference</option>
                        <option value="policy_decision">Policy decision</option>
                        <option value="external_event">Runtime event</option>
                      </Select>
                    </Field>
                    <Field label="From" htmlFor="pv-from">
                      <Input id="pv-from" type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
                    </Field>
                    <Field label="To" htmlFor="pv-to">
                      <Input id="pv-to" type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
                    </Field>
                    <Button type="submit" size="sm" variant="primary" disabled={filtering}>{filtering ? "…" : "Apply"}</Button>
                    {filtersActive && <Button size="sm" onClick={clearFilters}>Clear</Button>}
                  </form>
                  {provenance.history.length === 0 && <p className="ct-hint">No events match these filters.</p>}
                  <div className="er-timeline">
                    {provenance.history.map((block: Any) => (
                      <div key={block.blockIndex} className="er-timeline-item">
                        <code>#{block.blockIndex}</code>
                        <div>
                          <strong>{block.type}</strong> <span className="ct-hint">{block.timestamp}</span>
                          {aosRunUrl(block) && (
                            <>
                              {" "}
                              <a href={aosRunUrl(block)} target="_blank" rel="noopener noreferrer" className="ct-hint">
                                Run in AOS ↗
                              </a>
                            </>
                          )}
                          <div className="er-truncate"><code>{block.blockHash.substring(0, 24)}…</code></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          ) : (
            <Card>
              <EmptyState title="No model selected">Select a model from the list to view its details and provenance.</EmptyState>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
