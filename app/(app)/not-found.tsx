import { NotFoundBody } from "@/components/not-found-body";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Not found" };

export default function AppNotFound() {
  return (
    <>
      <PageHeader title="Not found" />
      <NotFoundBody />
    </>
  );
}
