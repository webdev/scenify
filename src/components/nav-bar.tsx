import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, isAdminEmail, signOut } from "@/lib/auth";

export default async function NavBar() {
  const session = await auth();
  const email = session?.user?.email ?? null;
  const isAdmin = isAdminEmail(email);

  return (
    <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-3">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            Sceneify
          </Link>
          {isAdmin && (
            <nav className="flex items-center gap-4 text-xs">
              <Link
                href="/"
                className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Dashboard
              </Link>
              <Link
                href="/admin"
                className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Presets
              </Link>
            </nav>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          {email ? (
            <>
              <span className="text-zinc-500" title={email}>
                {email}
              </span>
              <SignOutButton />
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function SignOutButton() {
  async function action() {
    "use server";
    await signOut({ redirectTo: "/admin/sign-in" });
    redirect("/admin/sign-in");
  }
  return (
    <form action={action}>
      <button
        type="submit"
        className="rounded-md border border-zinc-300 px-2.5 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        Sign out
      </button>
    </form>
  );
}
