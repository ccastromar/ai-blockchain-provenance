import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@chestertown/design";
import { getAllModelIds, getAllModels, logInference, registerModel } from "../lib/api";
import { useCan } from "../lib/auth";
import { errorMessage, type Any } from "../lib/types";

const REGISTRATION_DEFAULTS = {
  version: "0.1.0",
  params: '{"param1": "value1", "param2": 10}',
  metrics: '{"accuracy": 0.9, "f1_score": 0.85}',
  metadata: '{"dataset": "Sample Dataset", "framework": "PyTorch"}',
  mlflow: '{"modelHash": "0000000000000000000000000000000000000000000000000000000000000000", "gitCommit": "abcdef1234567890abcdef1234567890abcdef12"}',
};

/// Parses an optional JSON field, naming the field when it is not valid JSON.
function parseJson(label: string, text: string): Any {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function randomHash() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function ReadOnlyNote({ action }: { action: string }) {
  return <Alert tone="warn">Read-only access — {action} requires a read-write key.</Alert>;
}

export function ModelRegistration({ onSuccess }: { onSuccess?: (modelId: string) => void }) {
  const canWrite = useCan("evidence.write");
  const [existing, setExisting] = useState<Any[]>([]);
  const [preset, setPreset] = useState("");
  const [modelId, setModelId] = useState("");
  const [modelName, setModelName] = useState("");
  const [version, setVersion] = useState(REGISTRATION_DEFAULTS.version);
  const [params, setParams] = useState(REGISTRATION_DEFAULTS.params);
  const [metrics, setMetrics] = useState(REGISTRATION_DEFAULTS.metrics);
  const [metadata, setMetadata] = useState(REGISTRATION_DEFAULTS.metadata);
  const [mlflow, setMlflow] = useState(REGISTRATION_DEFAULTS.mlflow);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getAllModels().then(setExisting).catch(() => setExisting([]));
  }, []);

  function applyPreset(id: string) {
    setPreset(id);
    const m = existing.find((x) => x.modelId === id);
    if (!m) return;
    setModelId(m.modelId);
    setModelName(m.name ?? "");
    setVersion(m.version ?? REGISTRATION_DEFAULTS.version);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = {
        modelId,
        modelName,
        version,
        params: parseJson("Parameters", params),
        metrics: parseJson("Metrics", metrics),
        metadata: parseJson("Metadata", metadata),
        mlflow: parseJson("MLflow", mlflow),
      };
      setResult(await registerModel(data));
      setModelId("");
      setModelName("");
      setPreset("");
      setVersion(REGISTRATION_DEFAULTS.version);
      setParams(REGISTRATION_DEFAULTS.params);
      setMetrics(REGISTRATION_DEFAULTS.metrics);
      setMetadata(REGISTRATION_DEFAULTS.metadata);
      setMlflow(REGISTRATION_DEFAULTS.mlflow);
      onSuccess?.(data.modelId);
    } catch (err) {
      setError(errorMessage(err, "Failed to register model"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="er-stack er-form">
      <p className="ct-hint">Add a model registration block to the provenance chain.</p>
      {existing.length > 0 && (
        <Field label="Quick-fill from an existing model" htmlFor="reg-preset" hint="Fills model ID, name and version. Adjust the rest before submitting.">
          <Select id="reg-preset" value={preset} onChange={(e) => applyPreset(e.target.value)}>
            <option value="">— Select a model to pre-fill —</option>
            {existing.map((m) => (
              <option key={m.modelId} value={m.modelId}>{m.modelId} · {m.name ?? "No name"} · v{m.version}</option>
            ))}
          </Select>
        </Field>
      )}
      <form onSubmit={submit}>
        <div className="er-grid-2">
          <Field label="Model ID *" htmlFor="reg-modelId">
            <Input id="reg-modelId" required value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="chest-xray-classifier-v1" />
          </Field>
          <Field label="Version *" htmlFor="reg-version">
            <Input id="reg-version" required value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
          </Field>
        </div>
        <Field label="Model name *" htmlFor="reg-modelName">
          <Input id="reg-modelName" required value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="Chest X-ray Classifier v1" />
        </Field>
        <div className="er-grid-2">
          <Field label="Parameters (JSON)" htmlFor="reg-params">
            <Textarea id="reg-params" className="er-code-input" rows={4} value={params} onChange={(e) => setParams(e.target.value)} />
          </Field>
          <Field label="Metrics (JSON)" htmlFor="reg-metrics">
            <Textarea id="reg-metrics" className="er-code-input" rows={4} value={metrics} onChange={(e) => setMetrics(e.target.value)} />
          </Field>
        </div>
        <Field label="Metadata (JSON)" htmlFor="reg-metadata">
          <Textarea id="reg-metadata" className="er-code-input" rows={3} value={metadata} onChange={(e) => setMetadata(e.target.value)} />
        </Field>
        <Field label="MLflow (JSON)" htmlFor="reg-mlflow" hint="modelHash and gitCommit of the registered artifact">
          <Textarea id="reg-mlflow" className="er-code-input" rows={3} value={mlflow} onChange={(e) => setMlflow(e.target.value)} />
        </Field>
        {!canWrite && <div className="er-gap"><ReadOnlyNote action="registering a model" /></div>}
        <Button type="submit" variant="primary" disabled={loading || !canWrite}>{loading ? "Registering…" : "Register model"}</Button>
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
      {result && (
        <Alert tone="ok" title="Model registered">
          <dl className="er-inline-facts">
            <div><dt>Model ID</dt><dd>{result.modelId}</dd></div>
            <div><dt>Block</dt><dd>#{result.blockIndex}</dd></div>
            <div><dt>Hash</dt><dd><code>{result.blockHash}</code></dd></div>
          </dl>
        </Alert>
      )}
    </div>
  );
}

export function InferenceLogger({ initialModelId = "", onSuccess }: { initialModelId?: string; onSuccess?: (modelId: string) => void }) {
  const canWrite = useCan("evidence.write");
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [modelId, setModelId] = useState(initialModelId);
  // A fresh id per inference: Ernest treats a repeated (model, inference id) as the same event.
  const [inferenceId, setInferenceId] = useState<string>(() => crypto.randomUUID());
  const [inputHash, setInputHash] = useState(randomHash);
  const [outputHash, setOutputHash] = useState(randomHash);
  const [params, setParams] = useState('{"threshold": 0.8, "preprocessing": "normalize"}');
  const [metadata, setMetadata] = useState('{"dataset": "ChestX-ray14", "framework": "TensorFlow"}');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getAllModelIds().then(setModelIds).catch(() => setModelIds([]));
  }, []);
  useEffect(() => setModelId(initialModelId), [initialModelId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      setResult(
        await logInference({
          modelId,
          inferenceId,
          inputHash,
          outputHash,
          params: parseJson("Parameters", params),
          metadata: parseJson("Metadata", metadata),
        }),
      );
      setInferenceId(crypto.randomUUID());
      onSuccess?.(modelId);
    } catch (err) {
      setError(errorMessage(err, "Failed to log inference"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="er-stack er-form">
      <p className="ct-hint">Record a model inference — only the hashes of its input and output — on the chain.</p>
      <form onSubmit={submit}>
        <Field label="Model ID *" htmlFor="inf-modelId">
          {modelIds.length ? (
            <Select id="inf-modelId" required value={modelId} onChange={(e) => setModelId(e.target.value)}>
              <option value="">— Select a model —</option>
              {modelIds.map((id) => <option key={id} value={id}>{id}</option>)}
            </Select>
          ) : (
            <Input id="inf-modelId" required value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="chest-xray-classifier-v1" />
          )}
        </Field>
        <Field label="Inference ID *" htmlFor="inf-id">
          <Input id="inf-id" required className="er-code-input" value={inferenceId} onChange={(e) => setInferenceId(e.target.value)} />
        </Field>
        {([
          ["inf-input", "Input hash *", inputHash, setInputHash],
          ["inf-output", "Output hash *", outputHash, setOutputHash],
        ] as const).map(([id, label, value, set]) => (
          <Field key={id} label={label} htmlFor={id}>
            <div className="er-endpoint">
              <Input id={id} required className="er-code-input er-bare-input" value={value} onChange={(e) => set(e.target.value)} />
              <Button size="sm" variant="ghost" onClick={() => set(randomHash())}>Generate</Button>
            </div>
          </Field>
        ))}
        <div className="er-grid-2">
          <Field label="Parameters (JSON)" htmlFor="inf-params">
            <Textarea id="inf-params" className="er-code-input" rows={3} value={params} onChange={(e) => setParams(e.target.value)} />
          </Field>
          <Field label="Metadata (JSON)" htmlFor="inf-meta">
            <Textarea id="inf-meta" className="er-code-input" rows={3} value={metadata} onChange={(e) => setMetadata(e.target.value)} />
          </Field>
        </div>
        {!canWrite && <div className="er-gap"><ReadOnlyNote action="logging an inference" /></div>}
        <Button type="submit" variant="primary" disabled={loading || !canWrite}>{loading ? "Logging…" : "Log inference"}</Button>
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
      {result && (
        <Alert tone="ok" title="Inference logged">
          <dl className="er-inline-facts">
            <div><dt>Inference ID</dt><dd>{result.inferenceId}</dd></div>
            <div><dt>Block</dt><dd>#{result.blockIndex}</dd></div>
            <div><dt>Hash</dt><dd><code>{result.blockHash}</code></dd></div>
            {result.hashes && (
              <>
                <div><dt>Input hash</dt><dd><code>{result.hashes.input}</code></dd></div>
                <div><dt>Output hash</dt><dd><code>{result.hashes.output}</code></dd></div>
              </>
            )}
          </dl>
          {result.output && <pre className="er-pre">{JSON.stringify(result.output, null, 2)}</pre>}
        </Alert>
      )}
    </div>
  );
}
