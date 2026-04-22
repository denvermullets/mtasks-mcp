import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const configDir = () =>
  join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "jait");

const configFile = () => join(configDir(), "config.json");

export function readToken(): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(configFile(), "utf8"));
    return typeof parsed.token === "string" ? parsed.token : undefined;
  } catch {
    return undefined;
  }
}

export function writeToken(token: string): string {
  mkdirSync(configDir(), { recursive: true });
  const path = configFile();
  writeFileSync(path, JSON.stringify({ token }, null, 2));
  chmodSync(path, 0o600);
  return path;
}

export function clearToken(): boolean {
  const path = configFile();
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}
