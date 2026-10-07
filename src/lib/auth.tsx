"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User, Session } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;
    try {
      const sb = getSupabase();
      sb.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
        setSession(data.session);
        setLoading(false);
      });
      const { data } = sb.auth.onAuthStateChange(
        (_event: string, s: Session | null) => {
          setSession(s);
          setLoading(false);
        }
      );
      subscription = data.subscription;
    } catch {
      // Supabase not configured — treat as signed out instead of crashing.
      setLoading(false);
    }
    return () => subscription?.unsubscribe();
  }, []);

  const signOut = async () => {
    try {
      await getSupabase().auth.signOut();
    } catch {
      // not configured — nothing to sign out of
    }
  };

  return (
    <AuthContext.Provider
      value={{ user: session?.user ?? null, session, loading, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
