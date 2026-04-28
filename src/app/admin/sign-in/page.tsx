import { redirect } from "next/navigation";
import { auth, isAdminEmail, signIn } from "@/lib/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  if (session?.user?.email && isAdminEmail(session.user.email)) {
    redirect(params.callbackUrl ?? "/admin");
  }

  async function action() {
    "use server";
    await signIn("google", { redirectTo: params.callbackUrl ?? "/admin" });
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold tracking-tight">
          Sceneify · Admin
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Sign in with Google. Access is restricted to allowlisted accounts.
        </p>
        {params.error && (
          <div className="mt-4 rounded-md border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
            Sign-in failed or not authorized.
          </div>
        )}
        <form action={action} className="mt-6">
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M21.35 11.1H12v3.4h5.35c-.25 1.45-1.79 4.25-5.35 4.25-3.22 0-5.85-2.67-5.85-5.95s2.63-5.95 5.85-5.95c1.83 0 3.06.78 3.76 1.45l2.56-2.46C16.84 4.34 14.62 3.4 12 3.4 6.91 3.4 2.8 7.51 2.8 12.6S6.91 21.8 12 21.8c6.93 0 9.55-4.86 9.55-9.4 0-.63-.07-1.11-.2-1.3z" />
            </svg>
            Continue with Google
          </button>
        </form>
      </div>
    </div>
  );
}
