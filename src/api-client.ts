const apiUrl = process.env.MTASKS_API_URL;
const apiToken = process.env.MTASKS_API_TOKEN;

if (!apiUrl || !apiToken) {
  throw new Error(
    "Missing required environment variables: MTASKS_API_URL and MTASKS_API_TOKEN must be set"
  );
}

const BASE_URL = apiUrl.replace(/\/$/, "");

interface RequestOptions {
  method?: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | number | undefined>;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, params } = options;

  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiToken}`,
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
