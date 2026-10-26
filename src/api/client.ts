/**
 * Base API Client
 *
 * Unified fetch wrapper that combines:
 * - Security headers (X-Client-ID, X-Timestamp, X-CSRF-Token) from apiSecurity.ts
 * - Observability tracing (X-Trace-Id, X-Span-Id) from tracedFetch.ts
 * - Auto-resolved base URL from config
 *
 * Use this client for all backend API calls so headers are injected consistently.
 */

import { config } from "../utils/config";
import { observability } from "../observability";

function getClientIdentifier(): string {
    const factors = [
        navigator.userAgent,
        screen.width + "x" + screen.height,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        navigator.language,
    ];

    let hash = 0;
    const str = factors.join("|");
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }

    return Math.abs(hash).toString(36);
}

async function buildHeaders(
    method: string,
    extra?: HeadersInit,
): Promise<Headers> {
    const headers = new Headers(extra);

    if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    // Security headers
    headers.set("X-Client-ID", getClientIdentifier());
    headers.set("X-Timestamp", Date.now().toString());

    if (["POST", "PUT", "DELETE", "PATCH"].includes(method.toUpperCase())) {
        const csrfToken = sessionStorage.getItem("csrf-token") ||
            crypto.randomUUID();
        sessionStorage.setItem("csrf-token", csrfToken);
        headers.set("X-CSRF-Token", csrfToken);
    }

    // Trace headers
    const { traceId, spanId } = observability.createTraceContext();
    headers.set("X-Trace-Id", traceId);
    headers.set("X-Span-Id", spanId);

    return headers;
}

export interface ApiRequestOptions extends Omit<RequestInit, "headers"> {
    headers?: HeadersInit;
    /** Override base URL (defaults to config.apiUrl) */
    baseUrl?: string;
}

export interface ApiResponse<T> {
    data: T;
    status: number;
}

async function request<T>(
    path: string,
    options: ApiRequestOptions = {},
): Promise<ApiResponse<T>> {
    const { baseUrl, headers: extraHeaders, ...fetchOptions } = options;
    const method = fetchOptions.method || "GET";

    // Resolve base URL
    const resolvedBase = baseUrl ?? config.apiUrl;
    const normalizedBase = resolvedBase.endsWith("/")
        ? resolvedBase.slice(0, -1)
        : resolvedBase;
    const url = `${normalizedBase}${path}`;

    const headers = await buildHeaders(method, extraHeaders);
    const startTime = Date.now();
    const { traceId, spanId } = {
        traceId: headers.get("X-Trace-Id") ?? "",
        spanId: headers.get("X-Span-Id") ?? "",
    };

    try {
        const response = await fetch(url, { ...fetchOptions, headers });

        observability.recordAPICall({
            method,
            url,
            status: response.status,
            durationMs: Date.now() - startTime,
            traceId,
            spanId,
        });

        const rateLimitRemaining = response.headers.get(
            "X-RateLimit-Remaining",
        );
        if (rateLimitRemaining && parseInt(rateLimitRemaining) < 10) {
            console.warn(
                "Rate limit warning: Only",
                rateLimitRemaining,
                "requests remaining",
            );
        }

        if (!response.ok) {
            const text = await response.text();
            let message = text || `HTTP ${response.status}`;
            try {
                const json = JSON.parse(text);
                // NestJS puts the description in `message` and only the status
                // name ("Bad Request") in `error`.
                const nestMessage = typeof json.message === "string" ? json.message : undefined;
                message = nestMessage || json.error || json.detail || message;
            } catch {
                // plain text error
            }
            throw new ApiError(message, response.status);
        }

        const data: T = await response.json();
        return { data, status: response.status };
    } catch (error) {
        if (!(error instanceof ApiError)) {
            observability.recordAPICall({
                method,
                url,
                durationMs: Date.now() - startTime,
                traceId,
                spanId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        throw error;
    }
}

export class ApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

export const apiClient = {
    get<T>(path: string, options?: ApiRequestOptions) {
        return request<T>(path, { ...options, method: "GET" });
    },
    post<T>(path: string, body?: unknown, options?: ApiRequestOptions) {
        return request<T>(path, {
            ...options,
            method: "POST",
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    },
    put<T>(path: string, body?: unknown, options?: ApiRequestOptions) {
        return request<T>(path, {
            ...options,
            method: "PUT",
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    },
    delete<T>(path: string, options?: ApiRequestOptions) {
        return request<T>(path, { ...options, method: "DELETE" });
    },
};
