import { redirect } from "next/navigation";

export default function TenantAdminsLegacyRedirect() {
  redirect("/admin/tenants");
}
