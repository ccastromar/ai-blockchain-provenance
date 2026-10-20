import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, Badge, Button, Card, Page, Stat } from "@chestertown/design";
import {
  getIngestedEventStats, getIngestorAuthStatus, getIngestorHealth, simulateAzureMlEvent, simulateCloudEventsEvent,
  simulateDatabricksEvent, simulateHuggingFaceEvent, simulateOpenLineageEvent, simulateOpenTelemetryLogs,
  simulateSageMakerEvent, simulateVertexAiEvent,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage, shortHash, type Any } from "../lib/types";

interface Connector {
  id: string;
  name: string;
  source: string;
  endpoint: string;
  eventTypes: string[];
  note: string;
  /// Sends a sample event through the HTTP ingestor (generic HTTP has no sample of its own).
  simulate?: () => Promise<Any>;
}

const CONNECTORS: Connector[] = [
  {
    id: "huggingface", name: "Hugging Face Hub", source: "huggingface", endpoint: "/ingestor/events/huggingface",
    eventTypes: ["model.version.created", "model.registered", "model.card.updated"],
    note: "Repository activity mapped into model lifecycle evidence.", simulate: simulateHuggingFaceEvent,
  },
  {
    id: "generic-http", name: "Generic HTTP", source: "manual-normalizer-test", endpoint: "/ingestor/events",
    eventTypes: ["model.version.created", "inference.logged", "dataset.linked"],
    note: "Direct event intake for internal services and local emitters.",
  },
  {
    id: "cloudevents", name: "CloudEvents", source: "cloudevents", endpoint: "/ingestor/events/cloudevents",
    eventTypes: ["model.registered", "model.deployed", "inference.logged"],
    note: "Strict vendor-neutral CloudEvents 1.0 intake for event buses and gateways.", simulate: simulateCloudEventsEvent,
  },
  {
    id: "sagemaker", name: "SageMaker EventBridge", source: "sagemaker", endpoint: "/ingestor/events/sagemaker",
    eventTypes: ["training.completed", "model.approved", "model.deployed"],
    note: "Enterprise cloud connector for model package approval, training, and endpoint lifecycle.", simulate: simulateSageMakerEvent,
  },
  {
    id: "azureml", name: "Azure ML Event Grid", source: "azureml", endpoint: "/ingestor/events/azureml",
    eventTypes: ["model.registered", "training.completed", "model.deployed", "drift.detected"],
    note: "Azure-native connector for registry, run, and monitoring events.", simulate: simulateAzureMlEvent,
  },
  {
    id: "openlineage", name: "OpenLineage", source: "openlineage", endpoint: "/ingestor/events/openlineage",
    eventTypes: ["training.started", "training.completed", "dataset.linked"],
    note: "Training and dataset lineage intake for pipeline evidence.", simulate: simulateOpenLineageEvent,
  },
  {
    id: "otel", name: "OpenTelemetry", source: "opentelemetry", endpoint: "/ingestor/events/opentelemetry/logs",
    eventTypes: ["inference.logged", "drift.detected"],
    note: "Production inference evidence through observability pipelines.", simulate: simulateOpenTelemetryLogs,
  },
  {
    id: "databricks", name: "Databricks Unity Catalog", source: "databricks", endpoint: "/ingestor/events/databricks",
    eventTypes: ["model.version.created", "model.deployed", "dataset.linked"],
    note: "Unity Catalog model versions, aliases, serving, and lineage evidence.", simulate: simulateDatabricksEvent,
  },
  {
    id: "vertexai", name: "Vertex AI Audit Logs", source: "vertexai", endpoint: "/ingestor/events/vertexai",
    eventTypes: ["model.registered", "model.deployed", "training.started"],
    note: "Google Cloud audit logs routed through Pub/Sub into model lifecycle evidence.", simulate: simulateVertexAiEvent,
  },
];

export default function Connectors() {
  const canWrite = useAuth().role === "read-write";
  const [stats, setStats] = useState<Any>(null);
  const [authStatus, setAuthStatus] = useState<Any>(null);
  const [health, setHealth] = useState<Any>(null);
  // The HTTP event-ingestor is optional (deployments may ingest over Kafka only); without it the
  // page still shows ingested evidence, and the Simulate buttons, which need it, are hidden.
  const [ingestorAvailable, setIngestorAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [simulating, setSimulating] = useState("");
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const [simulation, setSimulation] = useState<Any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextStats, nextAuth, nextHealth] = await Promise.allSettled([
        getIngestedEventStats(),
        getIngestorAuthStatus(),
        getIngestorHealth(),
      ]);
      if (nextStats.status === "rejected") throw nextStats.reason;
      setStats(nextStats.value);
      setAuthStatus(nextAuth.status === "fulfilled" ? nextAuth.value : null);
      const h = nextHealth.status === "fulfilled" ? nextHealth.value : { status: "unavailable" };
      setHealth(h);
      // The backend answers this health check itself and reports whether it can reach the ingestor.
      setIngestorAvailable(h?.ingestor?.reachable === true);
    } catch (e) {
      setError(errorMessage(e, "Failed to load connector stats"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function simulate(connector: Connector) {
    if (!connector.simulate) return;
    setSimulating(connector.id);
    setSimulation(null);
    setError("");
    try {
      setSimulation(await connector.simulate());
      await load();
    } catch (e) {
      setError(errorMessage(e, "Failed to simulate connector event"));
    } finally {
      setSimulating("");
    }
  }

  async function copyEndpoint(endpoint: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${endpoint}`);
      setCopied(endpoint);
      setTimeout(() => setCopied((current) => (current === endpoint ? "" : current)), 1800);
    } catch {
      setError("Could not copy to the clipboard.");
    }
  }

  const canSimulate = canWrite && ingestorAvailable;
  const verified = (health?.stats?.byVerificationStatus?.provider_secret ?? 0) + (health?.stats?.byVerificationStatus?.provider_hmac ?? 0);
  const authRejected = health?.failureStats?.byFailureKind?.auth_rejected ?? 0;
  const latest = stats?.latest;

  return (
    <Page
      wide
      title="Connectors"
      subtitle="External AI platforms wired into Ernest evidence ingestion"
      actions={<Button size="sm" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</Button>}
    >
      <div className="er-stack-lg">
        {error && <Alert tone="danger">{error}</Alert>}
        {simulation && (
          <Alert tone="ok">
            {simulation.provider} event accepted as <strong>{simulation.eventType}</strong> · <code>{shortHash(simulation.rawEventHash, 10)}</code>
          </Alert>
        )}

        <div className="er-grid-4">
          <Stat value={stats?.total ?? 0} label="Ingested events" />
          <Stat value={CONNECTORS.length} label="Connectors" />
          <Stat value={latest?.blockIndex ? `#${latest.blockIndex}` : "—"} label="Latest block" />
          <Stat value={ingestorAvailable ? "Up" : "Off"} label="HTTP ingestor" hint={health?.ingestor?.status} />
        </div>

        <div className="er-events">
          <div className="er-grid-cards">
            {CONNECTORS.map((c) => (
              <Card key={c.id} title={c.name} actions={<Badge tone="ok">enabled</Badge>}>
                <div className="er-stack">
                  <p className="ct-hint">{c.note}</p>
                  <dl className="er-dl">
                    <div><dt>Events</dt><dd>{stats?.bySource?.[c.source] ?? 0}</dd></div>
                    <div><dt>Latest block</dt><dd>{latest?.source === c.source ? `#${latest.blockIndex}` : "—"}</dd></div>
                    <div><dt>Ingestor auth</dt><dd>{authStatus?.mode ?? "—"}</dd></div>
                  </dl>
                  <div className="er-endpoint">
                    <code className="er-truncate">{c.endpoint}</code>
                    <Button size="sm" variant="ghost" onClick={() => void copyEndpoint(c.endpoint)}>
                      {copied === c.endpoint ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <div className="ct-row">
                    {c.eventTypes.map((type) => (
                      <span key={type} className="er-chip">
                        {type}
                        {stats?.byEventType?.[type] > 0 ? ` · ${stats.byEventType[type]}` : ""}
                      </span>
                    ))}
                  </div>
                  <div className="ct-row">
                    {canSimulate && c.simulate && (
                      <Button size="sm" variant="primary" onClick={() => void simulate(c)} disabled={!!simulating}>
                        {simulating === c.id ? "Simulating…" : "Simulate"}
                      </Button>
                    )}
                    <Link to={`/events?source=${encodeURIComponent(c.source)}`} className="ct-btn ct-btn-outline ct-btn-sm">View events</Link>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="er-stack-lg">
            <Card title="Ingestor health" actions={<Badge tone={health?.status === "healthy" ? "ok" : "danger"}>{health?.status ?? "loading"}</Badge>}>
              <dl className="er-dl">
                <div><dt>Ingestor</dt><dd>{health?.ingestor?.status ?? "—"}</dd></div>
                <div><dt>Latency</dt><dd>{health?.ingestor?.latencyMs !== undefined ? `${health.ingestor.latencyMs} ms` : "—"}</dd></div>
                <div><dt>Auth</dt><dd>{health?.auth?.mode ?? authStatus?.mode ?? "—"}</dd></div>
                <div><dt>HF secret</dt><dd>{health?.auth?.providerSecrets?.huggingface ?? "—"}</dd></div>
                <div><dt>Provider HMAC</dt><dd>{health?.auth?.providerSecrets?.providerHmac ?? "—"}</dd></div>
                <div><dt>Provider verified</dt><dd className="er-ok">{verified}</dd></div>
                <div><dt>Auth rejected</dt><dd className={authRejected ? "er-danger" : "er-ok"}>{authRejected}</dd></div>
              </dl>
              {health?.failureStats?.latest && (
                <div className="er-field"><Alert tone="danger" title="Latest failure">{health.failureStats.latest.error}</Alert></div>
              )}
              <div className="er-field"><Link to="/events">Open ingested events →</Link></div>
            </Card>

            <Card title="Latest ingested event">
              {latest ? (
                <dl className="er-facts">
                  <div><dt className="ct-label">Source</dt><dd>{latest.source}</dd></div>
                  <div><dt className="ct-label">Event type</dt><dd>{latest.eventType}</dd></div>
                  <div className="er-span"><dt className="ct-label">Source event ID</dt><dd><code>{latest.sourceEventId}</code></dd></div>
                  <div><dt className="ct-label">Status</dt><dd>{latest.status}</dd></div>
                  <div><dt className="ct-label">Block</dt><dd>{latest.blockIndex ? `#${latest.blockIndex}` : "—"}</dd></div>
                  <div className="er-span"><dt className="ct-label">Block hash</dt><dd><code>{latest.blockHash ?? "—"}</code></dd></div>
                </dl>
              ) : (
                <p className="ct-hint">No ingested events yet.</p>
              )}
            </Card>

            <Card title="Top sources">
              {Object.keys(stats?.bySource ?? {}).length ? (
                <dl className="er-dl">
                  {Object.entries(stats.bySource).slice(0, 6).map(([source, count]) => (
                    <div key={source}><dt>{source}</dt><dd>{String(count)}</dd></div>
                  ))}
                </dl>
              ) : (
                <p className="ct-hint">No source metrics yet.</p>
              )}
            </Card>
          </div>
        </div>
      </div>
    </Page>
  );
}
