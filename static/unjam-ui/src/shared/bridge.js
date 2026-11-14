// Shared Forge bridge helpers for the Unjam Custom UI frontends.
//
// - getContext() caches the view context (one async call per page load).
// - invoke() is the @forge/bridge resolver call, re-exported for convenience.
// - enableTheming() turns on Atlassian design tokens (view.theme.enable):
//   the bridge injects the --ds-* CSS variables into this iframe and keeps
//   them in sync with the host theme (light/dark). It must run BEFORE the
//   first render. A theming failure must never blank the app, so callers
//   render either way: enableTheming().then(render, render).
import { invoke as bridgeInvoke, router, view } from '@forge/bridge';

let contextPromise = null;

export function getContext() {
  if (!contextPromise) contextPromise = view.getContext();
  return contextPromise;
}

export const invoke = bridgeInvoke;

export function enableTheming() {
  return view.theme.enable();
}

// Navigate the host Jira tab to an issue (relative URLs never prompt).
export function openIssue(issueKey) {
  return router.navigate(`/browse/${issueKey}`);
}

export { router, view };
