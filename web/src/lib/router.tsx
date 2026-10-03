import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

/** Tiny client-side router: four routes, history API, no dependency. nginx serves index.html for any path. */
export type Route = "/" | "/demo" | "/app" | "/security";
const ROUTES: Route[] = ["/", "/demo", "/app", "/security"];

// The video, README and SUBMISSION link /?demo=1: keep it working as /demo.
if (new URLSearchParams(window.location.search).get("demo") === "1") {
  window.history.replaceState(null, "", "/demo");
}

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener("popstate", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("popstate", fn);
  };
};
const current = (): Route => {
  const p = window.location.pathname.replace(/\/+$/, "") || "/";
  return (ROUTES as string[]).includes(p) ? (p as Route) : "/";
};

export function usePath(): Route {
  return useSyncExternalStore(subscribe, current);
}

export function navigate(to: Route) {
  if (to === current()) return;
  window.history.pushState(null, "", to);
  window.scrollTo(0, 0);
  listeners.forEach((fn) => fn());
}

export function Link({ to, onClick, ...rest }: { to: Route } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
