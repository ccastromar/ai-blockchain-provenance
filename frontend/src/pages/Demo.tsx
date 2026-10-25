import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, Button, Card, EmptyState, Page, Tabs } from "@chestertown/design";
import { InferenceLogger, ModelRegistration } from "../components/EvidenceForms";
import { getChainStats, seedDemoData } from "../lib/api";
import { useCan } from "../lib/auth";
import { errorMessage, type Any } from "../lib/types";

// Manual evidence entry. In the Chestertown MVP evidence arrives on its own (Prudence decisions
// and AOS executions over Kafka); this page only simulates it by hand for demos and evaluation.
type Tab = "register" | "inference";

export default function Demo() {
  const canWrite = useCan("evidence.write");
  const [tab, setTab] = useState<Tab>("register");
  const [stats, setStats] = useState<Any>(null);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [lastModelId, setLastModelId] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState("");
  const [seedError, setSeedError] = useState("");

  const loadStats = useCallback(() => {
    getChainStats().then(setStats).catch(() => setStats(null));
  }, []);
  useEffect(loadStats, [loadStats]);

  async function seed() {
    setSeeding(true);
    setSeedMessage("");
    setSeedError("");
    try {
      const result = await seedDemoData();
      setLastModelId(result.modelId ?? "demo-credit-risk-v1");
      setSeedMessage(result.created ? "Demo evidence created." : "Demo evidence already exists.");
      loadStats();
    } catch (e) {
      setSeedError(errorMessage(e, "Could not seed demo evidence."));
    } finally {
      setSeeding(false);
    }
  }

  const recorded = (id: string) => {
    loadStats();
    setSelectedModelId(id);
    setLastModelId(id);
    setSeedMessage("");
  };
  const modelLink = (
    <Link to={`/models?model=${encodeURIComponent(lastModelId)}`}>See its provenance in Models</Link>
  );

  return (
    <Page
      wide
      title="Demo"
      subtitle={
        stats
          ? `Manual evidence entry · ${stats.totalBlocks} blocks · ${stats.totalModels} models · chain ${stats.chainValid ? "valid" : "INVALID"}`
          : "Manual evidence entry for demos and evaluation"
      }
    >
      <div className="er-stack-lg">
        <Alert tone="warn" title="Manual entry — simulates what AOS and Prudence send automatically over Kafka.">
          In normal operation nobody registers models or logs inferences here: decisions and executions reach Ernest on
          their own. Everything created on this page is real evidence on the chain, so use it for demos and evaluation only.
        </Alert>

        {!canWrite ? (
          <Card>
            <EmptyState title="Read-write access needed"
                        action={<Link to="/login?redirect=/demo" className="ct-btn ct-btn-outline">Sign in</Link>}>
              Manual entry writes to the chain, so it needs a read-write sign-in.
            </EmptyState>
          </Card>
        ) : (
          <>
            <Card
              title="Seed a ready-to-audit credit-risk demo"
              actions={
                <>
                  <Button variant="primary" onClick={seed} disabled={seeding}>{seeding ? "Seeding…" : "Seed demo"}</Button>
                  <Link to="/auditor" className="ct-btn ct-btn-outline">Open audit</Link>
                </>
              }
            >
              <p className="ct-hint">
                Creates one model registration and two hash-only inference events, so Models and Audit have evidence immediately.
              </p>
              {seedMessage && (
                <div className="er-field">
                  <Alert tone="ok">
                    {seedMessage} {modelLink}, or <Link to="/auditor">open the audit</Link>.
                  </Alert>
                </div>
              )}
              {seedError && <div className="er-field"><Alert tone="danger">{seedError}</Alert></div>}
            </Card>

            <Card>
              <div className="er-card-tabs">
                <Tabs label="Manual entry" value={tab} onChange={setTab}
                      items={[{ id: "register", label: "Register model" }, { id: "inference", label: "Log inference" }]} />
              </div>
              {lastModelId && !seedMessage && (
                <div className="er-gap"><Alert tone="ok">Recorded for <code>{lastModelId}</code>. {modelLink}.</Alert></div>
              )}
              {tab === "register" ? (
                <ModelRegistration onSuccess={(id) => { recorded(id); setTab("inference"); }} />
              ) : (
                <InferenceLogger initialModelId={selectedModelId} onSuccess={recorded} />
              )}
            </Card>
          </>
        )}
      </div>
    </Page>
  );
}
