// État du réseau pour le badge « Online / Offline ». Dans le navigateur : navigator.onLine et les événements
// online/offline. Dans l'APK (WebView Capacitor), navigator.onLine reste vrai en mode avion : on lit alors
// l'état réel du téléphone avec le plugin natif @capacitor/network. L'analyse, elle, n'utilise jamais le réseau.

export interface NetworkPlugin {
  getStatus(): Promise<{ connected: boolean }>;
  addListener(event: "networkStatusChange", cb: (s: { connected: boolean }) => void): Promise<{ remove(): Promise<void> | void }>;
}

interface Scope {
  Capacitor?: { isNativePlatform?: () => boolean };
  navigator?: { onLine?: boolean };
  addEventListener?: (type: string, cb: () => void) => void;
  removeEventListener?: (type: string, cb: () => void) => void;
}

export function isNative(scope: Scope = globalThis as Scope): boolean {
  try {
    return scope.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

// Le plugin Capacitor est un Proxy qui répond à toute propriété, y compris `then` : le renvoyer tel quel d'une
// fonction async ferait attendre la promesse indéfiniment (vu sur l'émulateur). On l'enveloppe donc.
const loadPlugin = async (): Promise<NetworkPlugin> => {
  const { Network } = await import("@capacitor/network");
  return {
    getStatus: () => Network.getStatus(),
    addListener: (event, cb) => Network.addListener(event, cb),
  };
};

/** Appelle `cb` avec l'état courant puis à chaque changement. Renvoie la fonction de désabonnement. */
export function watchNetwork(
  cb: (online: boolean) => void,
  scope: Scope = globalThis as Scope,
  plugin: () => Promise<NetworkPlugin> = loadPlugin,
): () => void {
  if (isNative(scope)) {
    let stopped = false;
    let handle: { remove(): Promise<void> | void } | null = null;
    void (async () => {
      try {
        const net = await plugin();
        const s = await net.getStatus();
        if (!stopped) cb(s.connected);
        const h = await net.addListener("networkStatusChange", (st) => {
          if (!stopped) cb(st.connected);
        });
        if (stopped) void h.remove();
        else handle = h;
      } catch {
        // Plugin absent (ancienne APK) : repli sur navigator.onLine.
        if (!stopped) cb(scope.navigator?.onLine ?? true);
      }
    })();
    return () => {
      stopped = true;
      if (handle) void handle.remove();
    };
  }
  const on = () => cb(true);
  const off = () => cb(false);
  cb(scope.navigator?.onLine ?? true);
  scope.addEventListener?.("online", on);
  scope.addEventListener?.("offline", off);
  return () => {
    scope.removeEventListener?.("online", on);
    scope.removeEventListener?.("offline", off);
  };
}
