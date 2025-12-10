import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <>
      <h1 className="text-3xl">My App</h1>
      <div>Hello, world!</div>
    </>
  );
}
