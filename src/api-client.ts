import { readToken } from "./config-store.js";

const DEFAULT_API_URL = "https://justanotherissuetracker.com";

interface RequestOptions {
  method?: string;
  body?: Record<string, unknown>;
  // Sent as multipart/form-data instead of JSON (used for file uploads).
  form?: FormData;
  params?: Record<string, string | number | undefined>;
}

function getConfig() {
  const apiUrl = process.env.MTASKS_API_URL || DEFAULT_API_URL;
  const apiToken = process.env.MTASKS_API_TOKEN || readToken();

  if (!apiToken) {
    throw new Error(
      "No token found. Run 'npx @denvermullets/jait login <token>' or set MTASKS_API_TOKEN."
    );
  }

  return {
    baseUrl: apiUrl.replace(/\/$/, ""),
    token: apiToken,
  };
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { baseUrl, token } = getConfig();
  const { method = "GET", body, form, params } = options;

  const url = new URL(`${baseUrl}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  // For multipart, fetch sets Content-Type itself so it can include the boundary.
  if (!form) headers["Content-Type"] = "application/json";

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: form ?? (body ? JSON.stringify(body) : undefined),
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
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}
