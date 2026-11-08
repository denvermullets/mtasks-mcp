import { readToken } from "./config-store.js";

const DEFAULT_API_URL = "https://justanotherissuetracker.com";

interface RequestOptions {
  method?: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | number | undefined>;
}

function getConfig() {
  const apiToken = process.env.MTASKS_API_TOKEN || readToken();

  if (!apiToken) {
    throw new Error(
      "No token found. Run 'npx @denvermullets/jait login <token>' or set MTASKS_API_TOKEN."
    );
  }

  return {
    baseUrl: apiBaseUrl(),
    token: apiToken,
  };
}

export function apiBaseUrl(): string {
  return (process.env.MTASKS_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  return (await apiRequestWithHeaders<T>(path, options)).data;
}

// Same as apiRequest, plus the response headers (for cursors such as
// X-Next-Before-Id on the activity feeds).
export async function apiRequestWithHeaders<T>(
  path: string,
  options: RequestOptions = {}
): Promise<{ data: T; headers: Headers }> {
  const { baseUrl, token } = getConfig();
  const { method = "GET", body, params } = options;

  const url = new URL(`${baseUrl}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(errorBody);
      message =
        parsed.message || parsed.errors?.join(", ") || parsed.error || errorBody;
    } catch {
      message = errorBody;
    }
    throw new Error(`API error ${response.status}: ${message}`);
  }

  // Some endpoints (e.g. a 204 No Content on DELETE) return an empty body.
  // Guard against JSON.parse throwing "Unexpected end of JSON input".
  const text = response.status === 204 ? "" : await response.text();
  return {
    data: (text ? JSON.parse(text) : undefined) as T,
    headers: response.headers,
  };
}
