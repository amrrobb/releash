import { lazy, Suspense } from "react";
import { Nav } from "./components/Nav";
import { DemoPage } from "./pages/DemoPage";
import { LandingPage } from "./pages/LandingPage";
import { usePath } from "./lib/router";

const AppPage = lazy(() => import("./pages/AppPage").then((m) => ({ default: m.AppPage })));
const SecurityPage = lazy(() => import("./pages/SecurityPage").then((m) => ({ default: m.SecurityPage })));

const TITLES: Record<string, string> = {
  "/": "Releash — step away, keep risk in check",
  "/demo": "Demo · Releash",
  "/app": "My position · Releash",
  "/security": "Security & trust · Releash",
};

export default function App() {
  const path = usePath();
  document.title = TITLES[path];
  return (
    <>
      <Nav />
      <Suspense fallback={<main className="wrap" style={{ minHeight: "60vh" }} />}>
        {path === "/demo" ? <DemoPage /> : path === "/app" ? <AppPage /> : path === "/security" ? <SecurityPage /> : <LandingPage />}
      </Suspense>
    </>
  );
}
