import { NextResponse } from "next/server";

const API_URL = (process.env.API_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

/** Render probes PORT (Next.js) — proxy to Express so deploy health passes once API is up. */
export async function GET() {
  try {
    const res = await fetch(`${API_URL}/api/health`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { status: "starting", message: "API not ready yet" },
      { status: 503 }
    );
  }
}