import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { getMe } from "@/lib/session";
import { SessionProvider } from "@/lib/session-context";

/** Every app screen requires a valid session — checked against the API on the server, not just the cookie. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await getMe();
  if (!me) redirect("/login");
  return (
    <SessionProvider me={me}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
