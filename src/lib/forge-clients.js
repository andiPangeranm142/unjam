// Forge API adapters.
//
// This is the ONLY backend file that imports @forge/api for product calls
// (the handlers also import the KVS storage client, and nothing else).
// It adapts the Forge runtime calls to the plain fetcher/queryFn interfaces
// that JiraClient and TwgClient expect, so the lib clients stay testable
// with fakes and never depend on the Forge runtime directly.
//
// Two platform facts shape this file (see CONCEPT.md section 2.1/2.3):
//  - In @forge/api 8.5.0, requestJira only accepts a Route object, not a
//    string. JiraClient builds every path with validated/encoded dynamic
//    parts, so assumeTrustedRoute is safe here.
//  - Teamwork Graph is only available asUser(); AsAppFetchMethods has no
//    requestTeamworkGraph. NEVER call TWG from asApp (the scheduled watch
//    therefore uses Jira REST only).
import { asApp, asUser, assumeTrustedRoute } from '@forge/api';
import { JiraClient } from './jira.js';
import { TwgClient } from './twg.js';

// Parse a response body as JSON, returning null when the body is not JSON
// (for example an empty 204 or an HTML error page). A fetcher must never
// throw for a non-JSON body — JiraClient decides what a null body means.
async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildInit(method, body) {
  const init = { method, headers: { Accept: 'application/json' } };
  if (body !== null && body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return init;
}

// Build a Jira fetcher bound to one identity (asUser or asApp).
// Signature required by JiraClient:
//   async (method, path, body|null) => ({ status, ok, json })
// Network failures propagate as thrown errors; JiraClient converts them
// into JiraError. HTTP error statuses do NOT throw — they are returned.
function makeJiraFetcher(requestJira) {
  return async (method, path, body = null) => {
    const response = await requestJira(assumeTrustedRoute(path), buildInit(method, body));
    return { status: response.status, ok: response.ok, json: await parseJson(response) };
  };
}

// Jira REST as the invoking user (reads + writes the user is allowed to do).
export function asUserJira() {
  return new JiraClient(
    makeJiraFetcher((route, init) => asUser().requestJira(route, init)),
  );
}

// Jira REST as the app (used by the scheduled watch, which has no user).
export function asAppJira() {
  return new JiraClient(
    makeJiraFetcher((route, init) => asApp().requestJira(route, init)),
  );
}

// Teamwork Graph as the invoking user. Results are permission-filtered to
// what that user may see. Signature required by TwgClient:
//   async (queryText, variables, operationName) => ({ status, ok, json })
// where json is the raw GraphQL body ({ data?, errors? }).
export function asUserTwg() {
  return new TwgClient(async (query, variables, operationName) => {
    const response = await asUser().requestTeamworkGraph(query, variables, operationName);
    return { status: response.status, ok: response.ok, json: await parseJson(response) };
  });
}
