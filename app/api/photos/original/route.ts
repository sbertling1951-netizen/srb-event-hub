import { createAuthenticatedUserClient } from "@/lib/server/authenticatedUserClient";
import {
  resolveAuthenticatedRequest,
  type AuthenticatedRequestCredential,
} from "@/lib/server/authenticationBoundary";
import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";
import {
  createPhotoOriginalHandler,
  type PhotoOriginalUserClient,
} from "./handler";

export const GET = createPhotoOriginalHandler({
  resolveAuthenticatedRequest,
  createAuthenticatedUserClient: (credential) =>
    createAuthenticatedUserClient(
      credential as AuthenticatedRequestCredential,
    ) as PhotoOriginalUserClient | null,
  getSupabaseAdminClient,
});
