import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  try {
    const { updateSession } = await import("@/lib/supabase/middleware");
    return await updateSession(request);
  } catch {
    // If Supabase auth fails (missing env vars, edge incompatibility, etc.),
    // let the request through without auth
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
