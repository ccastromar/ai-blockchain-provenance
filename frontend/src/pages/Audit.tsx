import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, Page, Select, Spinner, Stat, type Tone } from "@chestertown/design";
import { getAllModels, getChainStats, getModelById, getProvenance, verifyChain } from "../lib/api";
import { buildLocalAuditReport, buildWebLlmPrompt, getModelId, type LocalAuditReport } from "../lib/local-auditor";
import { errorMessage, type Any } from "../lib/types";

const WEB_LLM_MODULE_URL = "https://esm.run/@mlc-ai/web-llm";
const DEFAULT_WEB_LLM_MODEL = "Llama-3.2-1B-Instruct-q4f32_1-MLC";

const FLOW = [
  ["Source registry", "hash, commit, metrics"],
  ["Ernest registration", "model lifecycle block"],
  ["Serving events", "input and output hashes"],
  ["Integrity proof", "verify and anchor"],
  ["Reviewer packet", "findings and export"],
] as const;

const CHECK_TONE: Record<string, Tone> = { present: "ok", missing: "danger", warning: "warn" };
const FINDING_TONE: Record<string, Tone> = { high: "danger", medium: "warn", low: "ok" };

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export default function Audit() {
  const [models, setModels] = useState<Any[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [model, setModel] = useState<Any>(null);
  const [stats, setStats] = useState<Any>(null);
  const [verification, setVerification] = useState<Any>(null);
  const [report, setReport] = useState<LocalAuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);
  const [error, setError] = useState("");
  const auditRequest = useRef(0);

  // Optional browser-side memo: WebLLM on WebGPU, loaded on demand.
  const engine = useRef<Any>(null);
  const [webLlmModel, setWebLlmModel] = useState(DEFAULT_WEB_LLM_MODEL);
  const [webLlmStatus, setWebLlmStatus] = useState("Idle");
  const [webLlmProgress, setWebLlmProgress] = useState("");
  const [webLlmError, setWebLlmError] = useState("");
  const [memo, setMemo] = useState("");
  const [runningMemo, setRunningMemo] = useState(false);

  const runAudit = useCallback(async (id: string, listed: Any[]) => {
    if (!id) return;
    const request = ++auditRequest.current;
    setLoading(true);
    setError("");
    setMemo("");
    setReport(null);
    try {
      const listedModel = listed.find((m) => getModelId(m) === id) ?? null;
      const [modelResult, provenance, loadedStats, loadedVerification] = await Promise.all([
        getModelById(id).catch(() => listedModel ?? { modelId: id }),
        getProvenance(id).catch(() => ({ blocks: [] })),
        getChainStats(),
        verifyChain(),
      ]);
      if (request !== auditRequest.current) return;
      const m = modelResult ?? listedModel ?? { modelId: id };
      setModel(m);
      setStats(loadedStats);
      setVerification(loadedVerification);
      setReport(buildLocalAuditReport({ model: m, provenance, stats: loadedStats, verification: loadedVerification }));
    } catch (e) {
      if (request === auditRequest.current) setError(errorMessage(e, "Could not run local audit."));
    } finally {
      if (request === auditRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [loadedModels, loadedStats, loadedVerification] = await Promise.all([getAllModels(), getChainStats(), verifyChain()]);
        setModels(loadedModels);
        setStats(loadedStats);
        setVerification(loadedVerification);
        const first = loadedModels.length ? getModelId(loadedModels[0]) : "";
        setSelectedId(first);
        if (first) await runAudit(first, loadedModels);
      } catch (e) {
        setError(errorMessage(e, "Could not load auditor data."));
      } finally {
        setLoadingModels(false);
      }
    })();
  }, [runAudit]);

  async function loadWebLlm() {
    setWebLlmError("");
    setWebLlmStatus("Checking browser");
    if (!("gpu" in navigator)) {
      setWebLlmStatus("Unavailable");
      setWebLlmError("This browser does not expose WebGPU. The deterministic local audit is still available.");
      return null;
    }
    try {
      setWebLlmStatus("Loading module");
      const webllm: Any = await import(/* @vite-ignore */ WEB_LLM_MODULE_URL);
      const createEngine = webllm.CreateMLCEngine ?? webllm.CreateWebWorkerMLCEngine;
      if (!createEngine) throw new Error("WebLLM engine factory was not found in the loaded module.");
      setWebLlmStatus("Loading model");
      engine.current = await createEngine(webLlmModel, {
        initProgressCallback: (progress: Any) =>
          setWebLlmProgress(progress?.text ?? `${Math.round((progress?.progress ?? 0) * 100)}%`),
      });
      setWebLlmStatus("Ready");
      return engine.current;
    } catch (e: Any) {
      setWebLlmStatus("Failed");
      setWebLlmError(e?.message ?? "Could not load WebLLM.");
      return null;
    }
  }

  async function generateMemo() {
    if (!report || !model) return;
    const llm = engine.current ?? (await loadWebLlm());
    if (!llm) return;
    setRunningMemo(true);
    setWebLlmError("");
    setMemo("");
    try {
      const completion = await llm.chat.completions.create({
        messages: [
          { role: "system", content: "You write precise AI governance audit notes." },
          { role: "user", content: buildWebLlmPrompt(model, report) },
        ],
        temperature: 0.2,
      });
      setMemo(completion?.choices?.[0]?.message?.content ?? "");
    } catch (e: Any) {
      setWebLlmError(e?.message ?? "Could not generate the local memo.");
    } finally {
      setRunningMemo(false);
    }
  }

  const chainValid = (verification?.isValid ?? stats?.chainValid) === true;
  const busyLoadingLlm = webLlmStatus === "Loading module" || webLlmStatus === "Loading model";

  return (
    <Page wide title="Audit readiness" subtitle="Evidence pipeline review, computed in your browser">
      <div className="er-stack-lg">
        <div className="er-split">
          <Card title="Evidence readiness cockpit">
            <p className="ct-hint er-gap">
              Trace a model from MLflow-style registration evidence through Ernest provenance, inference hashes, chain
              verification and optional anchoring.
            </p>
            {error && <div className="er-gap"><Alert tone="danger">{error}</Alert></div>}
            <form
              className="er-filters"
              onSubmit={(e) => {
                e.preventDefault();
                void runAudit(selectedId, models);
              }}
            >
              <div className="er-grow">
                <Field label="Model" htmlFor="audit-model">
                  <Select id="audit-model" value={selectedId} disabled={loadingModels || models.length === 0}
                          onChange={(e) => {
                            setSelectedId(e.target.value);
                            void runAudit(e.target.value, models);
                          }}>
                    {models.map((m) => (
                      <option key={getModelId(m)} value={getModelId(m)}>
                        {m.modelName ?? m.name ?? getModelId(m)} · {getModelId(m)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button type="submit" variant="primary" disabled={!selectedId || loading}>
                {loading ? "Auditing…" : "Run audit"}
              </Button>
            </form>
            {loadingModels ? (
              <Spinner label="Loading models…" />
            ) : (
              models.length === 0 && (
                <Alert tone="warn">
                  No models available yet. Evidence arrives from AOS and Prudence; to try it by hand, use Demo (read-write sign-in).
                </Alert>
              )
            )}
          </Card>
          <Card title="Evidence state">
            <dl className="er-dl">
              <div><dt>Blocks</dt><dd>{stats?.totalBlocks ?? "—"}</dd></div>
              <div><dt>Hashchain</dt><dd className={chainValid ? "er-ok" : "er-danger"}>{chainValid ? "Valid" : "Check"}</dd></div>
              <div><dt>Latest anchor</dt><dd>{stats?.latestAnchor || stats?.lastAnchor ? "Yes" : "No"}</dd></div>
            </dl>
          </Card>
        </div>

        {report && (
          <>
            <Card title="Evidence flow: MLflow to Ernest to audit packet" actions={<span className="ct-hint">{model?.name ?? model?.modelName ?? selectedId}</span>}>
              <ol className="er-flow">
                {FLOW.map(([label, detail], index) => (
                  <li key={label}>
                    <span className="ct-label">Step {index + 1}</span>
                    <strong>{label}</strong>
                    <span className="ct-hint">{detail}</span>
                  </li>
                ))}
              </ol>
            </Card>

            <div className="er-split er-split-left">
              <Card title="Audit score">
                <div className="er-score"><span>{report.score}</span>/100</div>
                <p className="ct-hint er-gap">{report.summary}</p>
                <div className="er-grid-2 er-gap">
                  <Stat value={report.eventCount} label="Events" />
                  <Stat value={report.inferenceCount} label="Inferences" />
                  <Stat value={report.modelRegistrationCount} label="Registrations" />
                  <Stat value={report.missingEvidence.length} label="Gaps" />
                </div>
                <Button onClick={() => download(`ernest-local-audit-${selectedId || "model"}.md`, report.evidencePacket, "text/markdown;charset=utf-8")}>
                  Download evidence
                </Button>
              </Card>

              <div className="er-stack-lg">
                <Card title="Evidence checks">
                  <div className="er-grid-2">
                    {report.evidenceChecks.map((check) => (
                      <div key={check.key} className="er-tile">
                        <div className="er-tile-head">
                          <span>{check.label}</span>
                          <Badge tone={CHECK_TONE[check.status] ?? "neutral"} dot>{check.status}</Badge>
                        </div>
                        <div className="ct-hint">{check.source}</div>
                        <div>{check.detail}</div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card title="Score dimensions">
                  <div className="er-stack">
                    {report.scoreBreakdown.map((item) => (
                      <div key={item.label}>
                        <div className="er-dl-row"><span>{item.label}</span><strong>{item.value}/{item.max}</strong></div>
                        <div className="er-bar" role="meter" aria-label={item.label} aria-valuemin={0} aria-valuemax={item.max} aria-valuenow={item.value}>
                          <span style={{ width: `${Math.max(0, Math.min(100, (item.value / item.max) * 100))}%` }} />
                        </div>
                        <p className="ct-hint">{item.detail}</p>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card title="Findings">
                  <div className="er-stack">
                    {report.findings.map((finding) => (
                      <div key={finding.title} className="er-tile">
                        <div className="ct-row"><Badge tone={FINDING_TONE[finding.level] ?? "neutral"}>{finding.level}</Badge><strong>{finding.title}</strong></div>
                        <div className="ct-hint">{finding.detail}</div>
                      </div>
                    ))}
                  </div>
                </Card>

                <div className="er-grid-2">
                  <Card title="Missing evidence">
                    <ul className="er-plain-list">
                      {(report.missingEvidence.length ? report.missingEvidence : ["None detected by local checks"]).map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </Card>
                  <Card title="Recommended actions">
                    <ul className="er-plain-list">
                      {report.recommendedActions.map((action) => <li key={action}>{action}</li>)}
                    </ul>
                  </Card>
                </div>
              </div>
            </div>

            <Card title="Browser-side audit memo (optional local LLM)">
              <p className="ct-hint er-gap">
                WebLLM runs in the browser with WebGPU. The model is downloaded from the WebLLM CDN; no prompt or evidence
                packet is sent to Ernest or to a third-party API by this page.
              </p>
              <div className="er-filters">
                <div className="er-grow">
                  <Field label="WebLLM model" htmlFor="webllm-model">
                    <Input id="webllm-model" value={webLlmModel} onChange={(e) => setWebLlmModel(e.target.value)} />
                  </Field>
                </div>
                <Button onClick={() => void loadWebLlm()} disabled={busyLoadingLlm}>Load WebLLM</Button>
                <Button variant="primary" onClick={() => void generateMemo()} disabled={runningMemo || !report}>
                  {runningMemo ? "Generating…" : "Generate memo"}
                </Button>
              </div>
              <p className="ct-hint er-gap">Status: <strong>{webLlmStatus}</strong>{webLlmProgress ? ` — ${webLlmProgress}` : ""}</p>
              {webLlmError && <div className="er-gap"><Alert tone="danger">{webLlmError}</Alert></div>}
              <pre className="er-pre er-pre-tall">{memo || report.evidencePacket}</pre>
            </Card>
          </>
        )}
      </div>
    </Page>
  );
}
