import { createAuthenticatedUserClient } from "@/lib/server/authenticatedUserClient";
import {
  resolveAuthenticatedRequest,
  type AuthenticatedRequestCredential,
} from "@/lib/server/authenticationBoundary";
import {
  createPhotoUploadHandler,
  type PhotoUploadClient,
  type PhotoUploadDependencies,
} from "./handler";

const dependencies: PhotoUploadDependencies = {
  resolveAuthenticatedRequest,
  createAuthenticatedUserClient: (credential) =>
    createAuthenticatedUserClient(
      credential as AuthenticatedRequestCredential,
    ) as PhotoUploadClient | null,
  randomUUID: () => crypto.randomUUID(),
};

export const POST = createPhotoUploadHandler(dependencies);
