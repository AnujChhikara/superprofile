// Custom-domain state machine + hostname validation. Kept dependency-injected
// so the state transitions are unit-testable without DNS or Azure.

export interface DomainRow {
  hostname: string;
  status: string; // pending_dns | verifying | active | failed
}

export interface AdvanceDeps {
  checkDns: (hostname: string) => Promise<{ cnameOk: boolean; txtOk: boolean }>;
  provisionDomain: (hostname: string) => Promise<void>;
}

export interface AdvanceResult {
  status: "pending_dns" | "verifying" | "active" | "failed";
  error: string | null;
}

const FQDN =
  /^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/;

export function validateHostname(
  input: string,
  apiHost: string,
  kbHost: string
): { ok: boolean; hostname?: string; error?: string } {
  const h = input.trim().toLowerCase();
  if (!FQDN.test(h)) return { ok: false, error: "not a valid domain name" };
  if (h === apiHost.toLowerCase() || h === kbHost.toLowerCase())
    return { ok: false, error: "cannot use one of our own hostnames" };
  return { ok: true, hostname: h };
}

// One step of the state machine. Re-checks DNS; on success moves to verifying
// and kicks provisioning (fire-and-forget — cert issuance takes minutes and
// updates the row itself). Active domains are left untouched.
export async function advanceDomain(
  row: DomainRow,
  deps: AdvanceDeps
): Promise<AdvanceResult> {
  if (row.status === "active") return { status: "active", error: null };

  const { cnameOk, txtOk } = await deps.checkDns(row.hostname);
  if (!cnameOk || !txtOk) {
    const missing = [!cnameOk && "CNAME", !txtOk && "TXT (asuid)"]
      .filter(Boolean)
      .join(" and ");
    return {
      status: "pending_dns",
      error: `Waiting for DNS — ${missing} record not found yet. Add the records below and retry.`,
    };
  }

  void deps.provisionDomain(row.hostname).catch(() => {});
  return { status: "verifying", error: null };
}
