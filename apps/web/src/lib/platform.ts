// Où se trouvent les modèles : dans l'APK (coquille Capacitor, fichiers servis depuis les assets de l'APK)
// ou à télécharger une fois depuis le serveur de l'app (PWA, copie dans Cache Storage pour le mode avion).
import type { ModelSource } from "../worker/protocol.ts";

interface CapacitorLike {
  isNativePlatform?: () => boolean;
}

/** "bundled" dans l'APK Capacitor : les modèles sont déjà sur le téléphone, les copier doublerait leur place. */
export function modelSourceFor(scope: { Capacitor?: CapacitorLike } = globalThis as { Capacitor?: CapacitorLike }): ModelSource {
  try {
    return scope.Capacitor?.isNativePlatform?.() === true ? "bundled" : "download";
  } catch {
    return "download";
  }
}
