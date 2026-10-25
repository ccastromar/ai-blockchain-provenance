import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, EmptyState, Input, Page, Spinner } from "@chestertown/design";
import Pager from "../components/Pager";
import { getAllBlocks, getBlockByIndex, getBlockProof } from "../lib/api";
import { errorMessage, shortHash, type Any } from "../lib/types";

const PAGE_SIZE = 10;

export default function Blocks() {
  const [blocks, setBlocks] = useState<Any[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState("");

  const [block, setBlock] = useState<Any>(null);
  const [previous, setPrevious] = useState<Any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [jumpIndex, setJumpIndex] = useState("");
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    setListError("");
    getAllBlocks(page, PAGE_SIZE, "desc") // newest first; #0 (genesis) last
      .then((res) => {
        if (cancelled) return;
        setBlocks(res.data);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      })
      .catch((e) => !cancelled && setListError(errorMessage(e, "Failed to load blocks")))
      .finally(() => !cancelled && setLoadingList(false));
    return () => {
      cancelled = true;
    };
  }, [page]);

  const selectBlock = useCallback(
    async (index: number) => {
      setBlock(null);
      setPrevious(null);
      setDetailError("");
      setReceiptError("");
      setLoadingDetail(true);
      try {
        const current = await getBlockByIndex(index);
        setBlock(current);
        if (index > 0) setPrevious(await getBlockByIndex(index - 1).catch(() => null));
      } catch (e: Any) {
        setDetailError(
          e?.response?.status === 404
            ? `Block #${index} does not exist — the chain currently ends at #${total - 1}.`
            : errorMessage(e, `Failed to load block #${index}`),
        );
      } finally {
        setLoadingDetail(false);
      }
    },
    [total],
  );

  function jump() {
    const n = Number(jumpIndex);
    if (jumpIndex !== "" && Number.isInteger(n) && n >= 0) void selectBlock(n);
  }

  async function downloadReceipt() {
    if (!block) return;
    setReceiptLoading(true);
    setReceiptError("");
    try {
      const receipt = await getBlockProof(block.index);
      const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `ernest-receipt-block-${block.index}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      // 409 carries the two interesting cases: not yet anchored, or the chain no longer
      // reproduces the anchored root (tamper evidence).
      setReceiptError(errorMessage(e, "Could not build the receipt."));
    } finally {
      setReceiptLoading(false);
    }
  }

  const linkIntact = !!block && !!previous && block.previousHash === previous.hash;

  return (
    <Page wide title="Hashchain blocks" subtitle={total > 0 ? `${total} blocks in the chain` : "The raw hashchain, block by block"}>
      <div className="er-master">
        <div className="er-master-list">
          <form
            className="er-inline"
            onSubmit={(e) => {
              e.preventDefault();
              jump();
            }}
          >
            <Input type="number" min={0} value={jumpIndex} onChange={(e) => setJumpIndex(e.target.value)}
                   placeholder="Jump to block #" aria-label="Block index" />
            <Button type="submit" size="sm">Go</Button>
          </form>
          {listError && <Alert tone="danger">{listError}</Alert>}
          <div className="er-list">
            {loadingList ? (
              <div className="er-list-empty">Loading…</div>
            ) : blocks.length === 0 ? (
              <div className="er-list-empty">No blocks yet.</div>
            ) : (
              blocks.map((b) => (
                <button key={b.index} type="button" className="er-list-item"
                        aria-current={block?.index === b.index ? "true" : undefined}
                        onClick={() => void selectBlock(b.index)}>
                  <div className="er-list-title">
                    <code>#{b.index}</code>
                    <span className="ct-hint">{b.data?.type ?? "genesis"}</span>
                  </div>
                  <div className="er-list-sub"><code>{shortHash(b.hash)}</code></div>
                </button>
              ))
            )}
          </div>
          <Pager page={page} totalPages={totalPages} onPage={setPage} />
        </div>

        <div>
          {loadingDetail ? (
            <Card><Spinner /></Card>
          ) : detailError ? (
            <Alert tone="danger">{detailError}</Alert>
          ) : block ? (
            <div className="er-stack">
              <div className="er-detail-head">
                <div>
                  <div className="ct-label">Block detail</div>
                  <div className="er-detail-id"><code>#{block.index}</code></div>
                </div>
                <div className="ct-row">
                  <Button size="sm" onClick={downloadReceipt} disabled={receiptLoading}
                          title="SPV-style inclusion receipt: Merkle proof connecting this block to its anchored root, verifiable offline">
                    {receiptLoading ? "Building…" : "Receipt"}
                  </Button>
                  <Button size="sm" onClick={() => void selectBlock(block.index - 1)} disabled={block.index <= 0}>
                    ← Block {block.index - 1}
                  </Button>
                  <Button size="sm" onClick={() => void selectBlock(block.index + 1)} disabled={block.index >= total - 1}>
                    Block {block.index + 1} →
                  </Button>
                </div>
              </div>
              {receiptError && <Alert tone="danger">{receiptError}</Alert>}
              {block.index > 0 ? (
                <Alert tone={linkIntact ? "ok" : "danger"}>
                  {linkIntact
                    ? `previousHash matches block #${block.index - 1}'s hash`
                    : `previousHash does NOT match block #${block.index - 1}'s hash`}
                </Alert>
              ) : (
                <Alert tone="info">Genesis block — chain start.</Alert>
              )}
              <Card>
                <dl className="er-facts">
                  <div>
                    <dt className="ct-label">Type</dt>
                    <dd>{block.data?.type ?? "genesis"}</dd>
                  </div>
                  <div>
                    <dt className="ct-label">Timestamp</dt>
                    <dd>{new Date(block.timestamp * 1000).toLocaleString()}</dd>
                  </div>
                  <div className="er-span">
                    <dt className="ct-label">Hash</dt>
                    <dd><code>{block.hash}</code></dd>
                  </div>
                  <div className="er-span">
                    <dt className="ct-label">Previous hash</dt>
                    <dd><code>{block.previousHash}</code></dd>
                  </div>
                  <div className="er-span">
                    <dt className="ct-label">Data</dt>
                    <dd><pre tabIndex={0} className="er-pre">{JSON.stringify(block.data, null, 2)}</pre></dd>
                  </div>
                </dl>
              </Card>
            </div>
          ) : (
            <Card>
              <EmptyState title="No block selected">Select a block from the list to inspect it, or jump to an index.</EmptyState>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
