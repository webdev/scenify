import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const ADMIN_EMAILS = new Set(
  ["gblazer@gmail.com", "info@slavablazer.com"].map((e) => e.toLowerCase()),
);

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      // Block sign-in entirely for non-admin emails. Sign-out flow returns
      // them to the home page; the admin UI is the only consumer of auth.
      return isAdminEmail(profile?.email);
    },
    async session({ session }) {
      // Carry an `isAdmin` flag through so server components can gate UI.
      if (session.user) {
        (session.user as { isAdmin?: boolean }).isAdmin = isAdminEmail(
          session.user.email,
        );
      }
      return session;
    },
  },
  pages: {
    signIn: "/admin/sign-in",
  },
});
