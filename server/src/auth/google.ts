import { env } from "../env.js";

export function googleAuthUrl(state: string) {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function exchangeCode(code: string): Promise<{
  sub: string;
  email: string;
  name: string;
  picture?: string;
}> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!r.ok) throw new Error(`google token exchange failed: ${r.status}`);
  const { access_token } = (await r.json()) as { access_token: string };
  const ui = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!ui.ok) throw new Error(`google userinfo failed: ${ui.status}`);
  return ui.json() as Promise<{ sub: string; email: string; name: string; picture?: string }>;
}
