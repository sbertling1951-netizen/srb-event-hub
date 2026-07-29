import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// "This is a shared device" support: a plain, non-identity boolean
// marker (never contains a session, token, or any identity value) that
// tells the storage adapter below which backend to use for the
// Supabase Auth session on the NEXT sign-in. It is always itself kept
// in localStorage (it has to be readable before any session exists),
// and is explicitly set immediately before each sign-in call and
// cleared on sign-out -- it never silently carries over stale intent.
const SHARED_DEVICE_STORAGE_KEY = "epicentrax-shared-device";

function isSharedDeviceModeActive(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(SHARED_DEVICE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setSharedDeviceMode(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (enabled) {
      window.localStorage.setItem(SHARED_DEVICE_STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(SHARED_DEVICE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors (e.g. Safari private browsing).
  }
}

export function isSharedDeviceMode(): boolean {
  return isSharedDeviceModeActive();
}

// Default (marker absent): sessions are written to localStorage, so a
// personal device stays signed in across browser restarts, bounded only
// by the Supabase project's dashboard-configured session lifetime and
// inactivity timeout (see docs/auth-session-policy notes in the member
// account work).
//
// Shared-device mode (marker "true"): sessions are written to
// sessionStorage instead, which the browser clears when the tab/window
// closes -- the safest practical, fully-client-side approximation of a
// non-persistent session this SDK supports without a custom transport.
// This does not defend against an attacker with same-tab script
// execution (XSS) any more than localStorage would; it defends against
// the realistic shared-device threat of the *next* person reopening the
// browser and finding an active session.
//
// removeItem always clears both backends so switching modes between
// sign-ins never leaves a stale session behind in the other one.
const conditionalAuthStorage = {
  getItem: (key: string) => {
    if (typeof window === "undefined") {
      return null;
    }
    const store = isSharedDeviceModeActive()
      ? window.sessionStorage
      : window.localStorage;
    return store.getItem(key);
  },
  setItem: (key: string, value: string) => {
    if (typeof window === "undefined") {
      return;
    }
    const store = isSharedDeviceModeActive()
      ? window.sessionStorage
      : window.localStorage;
    store.setItem(key, value);
  },
  removeItem: (key: string) => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-anon-key",
  {
    auth: {
      persistSession: true,
      // Automatic session refresh is required for the "stay signed in"
      // account policy -- without it, sessions would silently stop
      // working after the short-lived access token expires even though
      // a valid refresh token still exists.
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: conditionalAuthStorage,
    },
  },
);
