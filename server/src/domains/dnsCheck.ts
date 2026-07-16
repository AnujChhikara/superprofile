// DNS-over-HTTPS check via Google's resolver. fetch is injectable for tests.
type FetchLike = typeof fetch;

async function resolve(
  fetchImpl: FetchLike,
  name: string,
  type: "CNAME" | "TXT"
): Promise<string[]> {
  try {
    const res = await fetchImpl(
      `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { Answer?: Array<{ data: string }> };
    return (data.Answer ?? []).map((a) => a.data);
  } catch {
    return [];
  }
}

export async function checkDns(
  hostname: string,
  expectedCname: string,
  verificationId: string,
  fetchImpl: FetchLike = fetch
): Promise<{ cnameOk: boolean; txtOk: boolean }> {
  const [cnames, txts] = await Promise.all([
    resolve(fetchImpl, hostname, "CNAME"),
    resolve(fetchImpl, `asuid.${hostname}`, "TXT"),
  ]);
  const norm = (s: string) => s.replace(/\.$/, "").replace(/^"|"$/g, "").toLowerCase();
  const cnameOk = cnames.some((c) => norm(c) === expectedCname.toLowerCase());
  const txtOk = txts.some((t) => norm(t) === verificationId.toLowerCase());
  return { cnameOk, txtOk };
}
