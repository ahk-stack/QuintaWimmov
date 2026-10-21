import Image from "next/image";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { SetupRequired } from "@/components/setup-required";
import { getSession } from "@/lib/auth/session";
import { storeKind } from "@/lib/db";

/*
 * Outside the (hub) group on purpose: it must render without a session, and
 * without the roster the hub shell loads.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (storeKind() === "unconfigured") return <SetupRequired />;

  // Already signed in: nothing to do here.
  if (await getSession()) redirect("/");

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex items-baseline gap-3">
          <Image
            src="/brand/quinta-wordmark-black.svg"
            alt="Quinta"
            width={286}
            height={88}
            priority
            className="h-6 w-auto"
          />
          <span className="border-l border-line-strong pl-3 text-sm font-bold">Lead Hub</span>
        </div>

        <h1 className="text-3xl">Sign in</h1>
        <p className="mt-2 text-sm text-muted">
          Use the username and password an admin gave you.
        </p>

        <LoginForm />

        <p className="mt-10 text-xs text-muted">
          Forgotten your password? Ask an admin to set a new one.
        </p>
      </div>
    </main>
  );
}
