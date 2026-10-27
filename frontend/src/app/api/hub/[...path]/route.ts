/**
 * Server-side proxy to the FastAPI dashboard API.
 *
 * The browser calls /api/hub/<anything>; this forwards it to
 * <HUB_API_BASE_URL>/api/v1/<anything> with the dashboard key attached. The key
 * stays on the server, so it never reaches the client bundle.
 *
 * The PUBLIC chat does NOT go through here — it has no secret and talks to
 * FastAPI directly. Only the owner's screens need this.
 */

import { NextResponse } from "next/server";

const BASE_URL = process.env.HUB_API_BASE_URL ?? "http://127.0.0.1:8000";
const DASHBOARD_KEY = process.env.HUB_DASHBOARD_KEY ?? "";

/** Never cache: this is live operational data. */
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

async function forward(request: Request, context: Context, method: string) {
  const { path } = await context.params;
  const search = new URL(request.url).search;
  const target = `${BASE_URL}/api/v1/${path.join("/")}${search}`;

  if (!DASHBOARD_KEY) {
    return NextResponse.json(
      { detail: "HUB_DASHBOARD_KEY is not set in frontend/.env.local" },
      { status: 500 },
    );
  }

  // Read as bytes, not text: a document upload is multipart/form-data with
  // binary in it, and text() would corrupt anything that is not UTF-8.
  const hasBody = method !== "GET" && method !== "DELETE";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  // Forward the caller's own content type so multipart keeps its boundary
  // marker. Falling back to JSON keeps every existing call working.
  const contentType = request.headers.get("content-type") ?? "application/json";
  const headers: Record<string, string> = { "X-Dashboard-Key": DASHBOARD_KEY };
  if (hasBody) headers["Content-Type"] = contentType;

  try {
    const response = await fetch(target, {
      method,
      headers,
      body,
      cache: "no-store",
    });

    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        detail: "Could not reach the backend.",
        target,
        cause: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

export async function GET(request: Request, context: Context) {
  return forward(request, context, "GET");
}
export async function POST(request: Request, context: Context) {
  return forward(request, context, "POST");
}
export async function PATCH(request: Request, context: Context) {
  return forward(request, context, "PATCH");
}
export async function DELETE(request: Request, context: Context) {
  return forward(request, context, "DELETE");
}
