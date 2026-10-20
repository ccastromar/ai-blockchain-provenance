import { Button } from "@chestertown/design";

/// Previous / next for paged lists; hidden when everything fits on one page.
export default function Pager({ page, totalPages, onPage }: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="er-pager" aria-label="Pages">
      <Button size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>← Prev</Button>
      <span className="ct-hint">Page {page} / {totalPages}</span>
      <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>Next →</Button>
    </nav>
  );
}
