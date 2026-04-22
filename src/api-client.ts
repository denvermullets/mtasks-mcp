import { readToken } from "./config-store.js";

const DEFAULT_API_URL = "https://justanotherissuetracker.com";

interface RequestOptions {
  method?: string;
  body?: Record<string, unknown>;
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
  const { method = "GET", body, params } = options;

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
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const response = await fetch(url.toString(), {
    method,
    headers,
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

  return response.json() as Promise<T>;
}
