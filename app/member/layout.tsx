import { MemberWorkspaceProvider } from "@/lib/memberWorkspace";

export default function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MemberWorkspaceProvider>{children}</MemberWorkspaceProvider>;
}
