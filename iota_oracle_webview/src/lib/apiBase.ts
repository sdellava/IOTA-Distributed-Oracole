// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

function isLoopbackHostname(hostname: string): boolean {
  const value = String(hostname || "").trim().toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

export function resolveApiBaseUrl(): string {
  const configured = String(import.meta.env.VITE_API_BASE_URL || "").trim();
  if (!configured) return "";

  if (typeof window === "undefined") return configured.replace(/\/+$/, "");

  try {
    const configuredUrl = new URL(configured, window.location.origin);
    const pageIsLocal = isLoopbackHostname(window.location.hostname);
    const apiIsLocal = isLoopbackHostname(configuredUrl.hostname);

    // Avoid shipping a localhost API base into public deployments.
    if (apiIsLocal && !pageIsLocal) {
      return "";
    }

    return configuredUrl.origin.replace(/\/+$/, "");
  } catch {
    return configured.replace(/\/+$/, "");
  }
}
