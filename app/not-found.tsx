import { NotFoundBody } from "@/components/not-found-body";

export const metadata = { title: "Not found" };

export default function RootNotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <NotFoundBody />
      </div>
    </main>
  );
}
