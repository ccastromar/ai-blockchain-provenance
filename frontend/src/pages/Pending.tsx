import { useLocation } from "react-router";
import { Card, EmptyState, Page } from "@chestertown/design";

/// Placeholder for the screens still being moved from the Svelte console.
export default function Pending() {
  const { pathname } = useLocation();
  return (
    <Page wide>
      <Card>
        <EmptyState title={`${pathname} is not in the React console yet`}>
          This screen moves over in a later phase; the Svelte console still serves it.
        </EmptyState>
      </Card>
    </Page>
  );
}
