/*
 * Phase 0 placeholder: a brand smoke test. It exists to prove the Caladea /
 * Lato pipeline and the status tokens render correctly. Phase 1 replaces this
 * with the real dashboard.
 */
const STATUSES = [
  { label: "Won", token: "text-status-won", hex: "#2E7D32" },
  { label: "Watch", token: "text-status-watch", hex: "#EF6C00" },
  { label: "Lost", token: "text-status-lost", hex: "#C62828" },
  { label: "Info", token: "text-status-info", hex: "#1565C0" },
  { label: "Pending", token: "text-status-pending", hex: "#616161" },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-20">
      <p className="font-sans text-xs font-bold tracking-[0.2em] text-muted uppercase">
        Quinta · Internal
      </p>
      <h1 className="mt-4 text-5xl leading-[1.05]">Lead Hub</h1>
      <p className="mt-5 max-w-xl font-sans text-lg text-muted">
        One place where sales and consultants pass leads to each other, talk
        them through, and see what shipped.
      </p>

      <div className="mt-14 border-t border-line pt-8">
        <h2 className="text-sm tracking-wide uppercase">Status system</h2>
        <ul className="mt-5 flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <li
              key={s.label}
              className={`${s.token} rounded-full border border-current px-3 py-1 font-sans text-sm font-bold`}
            >
              {s.label}
              <span className="ml-2 font-normal opacity-60">{s.hex}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 font-sans text-sm text-muted">
          Headings are Caladea Bold. Body is Lato. Colour appears only as
          status.
        </p>
      </div>
    </main>
  );
}
