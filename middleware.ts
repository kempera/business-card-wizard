import { NextRequest, NextResponse } from "next/server";

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Business Card Wizard"' }
  });
}

export function middleware(request: NextRequest) {
  const password = process.env.APP_AUTH_PASSWORD?.trim();
  if (!password) return NextResponse.next();

  const user = process.env.APP_AUTH_USER?.trim() || "admin";
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return unauthorized();

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  const candidateUser = decoded.slice(0, separator);
  const candidatePassword = decoded.slice(separator + 1);

  if (candidateUser === user && candidatePassword === password) {
    return NextResponse.next();
  }

  return unauthorized();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
