import { useContext } from "react";

import { MemberWorkspaceContext } from "@/lib/memberWorkspace/MemberWorkspaceProvider";

export function useMemberWorkspace() {
  const context = useContext(MemberWorkspaceContext);

  if (!context) {
    throw new Error("useMemberWorkspace must be used within MemberWorkspaceProvider");
  }

  return context;
}
