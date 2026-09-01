/**
 * Shown when the app is deployed with no data store configured.
 *
 * The hub layout renders this instead of the page, so an unconfigured
 * deployment explains itself rather than throwing a 500 on every route. It
 * names only environment variables, never their values.
 */
export function SetupRequired() {
  return (
    <main className="mx-auto w-full max-w-xl px-6 py-24">
      <p className="text-xs font-bold tracking-[0.2em] text-muted uppercase">
        Quinta Lead Hub
      </p>
      <h1 className="mt-3 text-3xl leading-tight">Not configured yet</h1>
      <p className="mt-4 text-base text-muted">
        This deployment has no database, so there is nothing to show. Set the
        Supabase environment variables and redeploy.
      </p>

      <div className="mt-8 rounded-xl border border-line p-6">
        <h2 className="text-xs font-bold tracking-[0.16em] uppercase">
          Required
        </h2>
        <ul className="mt-3 space-y-1.5 font-mono text-sm">
          <li>NEXT_PUBLIC_SUPABASE_URL</li>
          <li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
          <li>SUPABASE_SERVICE_ROLE_KEY</li>
        </ul>
        <p className="mt-4 text-sm text-muted">
          The service-role key is server-only. Never expose it through a{" "}
          <code className="font-mono">NEXT_PUBLIC_</code> variable.
        </p>
      </div>

      <div className="mt-4 rounded-xl border border-dashed border-line-strong p-6">
        <h2 className="text-xs font-bold tracking-[0.16em] uppercase">
          Just want a demo?
        </h2>
        <p className="mt-3 text-sm text-muted">
          Set <code className="font-mono">ALLOW_DEV_STORE=true</code> to run on
          the seeded local file store. State lives on each instance&rsquo;s disk,
          so it is not shared between visitors and a redeploy wipes it. Fine for
          a walkthrough, never for real leads.
        </p>
      </div>
    </main>
  );
}
