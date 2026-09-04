"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * One operator token per session, shared by every surface that needs it.
 *
 * It was previously held in three separate component states — the dashboard
 * hero, the control page's emergency panel and the signals page each had their
 * own — so an operator typed the same secret three times and a page reload
 * lost all three.
 *
 * sessionStorage rather than localStorage: it should not outlive the tab. The
 * value is only ever sent as a bearer header, and the server is the only thing
 * that can decide whether it is right.
 */
const KEY = "nutshell_operator_token";

export function useOperatorToken() {
  const [token, setTokenState] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setTokenState(sessionStorage.getItem(KEY) ?? "");
      } catch {
        /* private mode */
      }
      setLoaded(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const setToken = useCallback((value: string) => {
    setTokenState(value);
    try {
      if (value.trim()) sessionStorage.setItem(KEY, value.trim());
      else sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  /** Bearer header when a token is present, nothing when it is not. */
  const authHeaders = useCallback(
    (): Record<string, string> =>
      token.trim() ? { authorization: `Bearer ${token.trim()}` } : {},
    [token],
  );

  return { token, setToken, authHeaders, hasToken: token.trim().length > 0, loaded };
}
