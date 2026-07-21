import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;

export const resend = apiKey && apiKey.length > 0 ? new Resend(apiKey) : null;

export function emailEnabled() {
  return resend !== null;
}
