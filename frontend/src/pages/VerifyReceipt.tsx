import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Card, Field, Page, Spinner, Textarea } from "@chestertown/design";
import type { Any } from "../lib/types";

type Verifier = (json: string) => string;

/// One line of the verdict: a check that passed, failed, or does not apply yet.
function Check({ ok, pending, children }: { ok?: boolean; pending?: boolean; children: ReactNode }) {
  const state = pending ? "pending" : ok ? "ok" : "fail";
  return (
    <li className={`er-check-line er-check-${state}`}>
      <span aria-hidden="true">{pending ? "○" : ok ? "✓" : "✗"}</span>
      <div>{children}</div>
    </li>
  );
}

export default function VerifyReceipt() {
  // The verifier runs entirely in the browser via WebAssembly (merkle-wasm, Rust): no request
  // leaves this page. The wasm implementation is pinned byte-for-byte to the backend and Go
  // verifiers by the shared golden fixtures in testdata/.
  const verifiers = useRef<{ receipt: Verifier; event: Verifier } | null>(null);
  const [wasmReady, setWasmReady] = useState(false);
  const [wasmError, setWasmError] = useState("");

  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<Any>(null);
  const [anchor, setAnchor] = useState<Any>(null);
  const [block, setBlock] = useState<Any>(null);
  // ADR-004 event proof (GET /api/events/{source}/{eventId}/proof) rather than a block receipt.
  const [event, setEvent] = useState<Any>(null);
  const [anchoredRoot, setAnchoredRoot] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const wasm = await import("../lib/merkle-wasm/merkle_wasm.js");
        await wasm.default();
        verifiers.current = { receipt: wasm.verify_receipt, event: wasm.verify_event_proof };
        setWasmReady(true);
      } catch (e: Any) {
        setWasmError(e?.message ?? "Could not load the WebAssembly verifier.");
      }
    })();
  }, []);

  function verify(json: string) {
    setResult(null);
    setAnchor(null);
    setBlock(null);
    setEvent(null);
    setAnchoredRoot(null);
    const v = verifiers.current;
    if (!v || !json.trim()) return;
    let parsed: Any = null;
    try {
      parsed = JSON.parse(json);
    } catch {
      /* the verifier reports the parse error */
    }
    if (parsed?.inclusion) {
      setResult(JSON.parse(v.event(json)));
      setEvent(parsed.event ?? null);
      setBlock(parsed.block ?? null);
      setAnchor(parsed.anchor?.anchor ?? null);
      setAnchoredRoot(parsed.anchor?.merkleRoot ?? null);
    } else {
      setResult(JSON.parse(v.receipt(json)));
      setAnchor(parsed?.anchor ?? null);
      setBlock(parsed?.block ?? null);
      setAnchoredRoot(parsed?.merkleRoot ?? null);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    const content = await file.text();
    setText(content);
    verify(content);
  }

  return (
    <Page title="Verify evidence receipt" subtitle="Check a receipt or an event proof offline, in your browser">
      <div className="er-stack-lg">
        <Card title="Offline verification">
          <p className="ct-hint er-gap">
            Drop an inclusion receipt (from a block's <em>Receipt</em> button or <code>GET /api/blocks/:index/proof</code>), or
            an event proof (<code>GET /api/events/:source/:eventId/proof</code>). Verification runs entirely in your browser
            via WebAssembly — nothing is sent anywhere: the block data must reproduce its hash, and the hash must climb the
            Merkle proof to the anchored root.
          </p>
          {wasmError ? (
            <Alert tone="danger">{wasmError}</Alert>
          ) : !wasmReady ? (
            <Spinner label="Loading the WebAssembly verifier…" />
          ) : (
            <div className="er-stack">
              <Field label="Receipt file" htmlFor="receipt-file">
                <input id="receipt-file" className="er-file" type="file" accept=".json,application/json"
                       onChange={(e) => void onFile(e.target.files?.[0])} />
              </Field>
              <Field label="…or paste the receipt JSON" htmlFor="receipt-json">
                <Textarea id="receipt-json" className="er-code-input" rows={6} value={text}
                          onChange={(e) => {
                            setFileName("");
                            setText(e.target.value);
                            verify(e.target.value);
                          }} />
              </Field>
            </div>
          )}
        </Card>

        {result && (
          <Card title={`Verdict${fileName ? ` · ${fileName}` : ""}`}>
            {result.error && !result.signaturePresent ? (
              <Alert tone="danger">{result.error}</Alert>
            ) : (
              <div className="er-stack">
                <Alert tone={result.valid ? "ok" : "danger"}>
                  <strong className="er-verdict">{result.valid ? "Receipt verified" : "Receipt INVALID"}</strong>
                </Alert>
                <ul className="er-checks">
                  {event && (
                    <Check ok={result.leafMatchesData}>
                      Event data reproduces its {result.kind === "batch" ? "leaf hash" : "block data"}
                    </Check>
                  )}
                  {event && result.kind === "batch" && (
                    <Check ok={result.inclusionReachesBlock}>
                      RFC 6962 audit path ({result.auditPathLength} hashes) reaches the batch root committed in the block
                    </Check>
                  )}
                  <Check ok={result.dataMatchesHash}>
                    Block data reproduces its hash
                    {!result.dataMatchesHash && result.computedHash && <div className="ct-hint"><code>computed: {result.computedHash}</code></div>}
                  </Check>
                  {!event ? (
                    <Check ok={result.proofReachesRoot}>Merkle proof ({result.proofLength} hashes) reaches the anchored root</Check>
                  ) : result.anchored ? (
                    <Check ok={result.anchorProofReachesRoot}>Anchor proof reaches the anchored root</Check>
                  ) : (
                    <Check pending>Block not covered by an anchor yet — fetch the proof again once it is</Check>
                  )}
                  {result.signaturePresent && (
                    <Check ok={result.signatureValid}>
                      Emitter signature — signed by <code>{result.signedBy}</code>
                      {!result.signatureValid && result.error && <div className="ct-hint">{result.error}</div>}
                    </Check>
                  )}
                </ul>

                {result.valid && block && anchor && (
                  <div className="er-verdict-facts">
                    {event && (
                      <div>
                        Event <code>{event.source} / {event.eventId}</code> · seq {event.seq} · {event.data?.type ?? "—"}
                      </div>
                    )}
                    <div>
                      Block <code>#{block.index}</code> · {block.data?.type ?? "—"}
                      {block.data?.modelId && <> · model <code>{block.data.modelId}</code></>}
                    </div>
                    <div className="ct-hint">Anchored root: <code>{anchoredRoot ?? "—"}</code></div>
                    {anchor.provider === "ots" ? (
                      <>
                        <div className="ct-hint">
                          Anchoring: OpenTimestamps (Bitcoin)
                          {anchor.bitcoinBlockHeight ? `, attested at block ${anchor.bitcoinBlockHeight}` : " — pending aggregation"}
                        </div>
                        <div className="ct-hint">Anchored at {anchor.anchoredAt} · covers blocks 0..{anchor.lastBlockIndex}</div>
                        <p className="ct-hint">
                          To complete the chain of trust, verify the OpenTimestamps proof against Bitcoin (download the .ots
                          proof and root from Ernest, then <code>ots verify</code>).
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="ct-hint">Anchor tx: <code>{anchor.txHash}</code> (chainId {anchor.chainId})</div>
                        <div className="ct-hint">Anchored at {anchor.anchoredAt} · covers blocks 0..{anchor.lastBlockIndex}</div>
                        <p className="ct-hint">To complete the chain of trust, confirm that transaction records this root on the public chain.</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
        )}
      </div>
    </Page>
  );
}
