import { Link, useLocation } from "react-router";
import { Card, EmptyState, Page } from "@chestertown/design";

export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <Page wide>
      <Card>
        <EmptyState title="Page not found" action={<Link to="/" className="ct-btn ct-btn-outline">Go to the overview</Link>}>
          Ernest has no page at <code>{pathname}</code>.
        </EmptyState>
      </Card>
    </Page>
  );
}
