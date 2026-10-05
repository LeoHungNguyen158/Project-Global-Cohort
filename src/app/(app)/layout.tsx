import { AppShell, PublicShell } from "@/components/layout/app-shell";
import { getCurrentUser } from "@/lib/auth";

// Pages inside this group require sign-in unless they are explicitly public
// (help, legal pages, optional public catalog). Each protected page calls requireUser().
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) return <PublicShell>{children}</PublicShell>;
  return <AppShell user={user}>{children}</AppShell>;
}
