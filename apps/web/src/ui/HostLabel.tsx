// Libellés de l'app hôte en mode A : phrase kinyarwanda figée du catalogue (jamais traduite au runtime) avec une
// icône, pour une hôtesse qui ne lit que le kinyarwanda. L'anglais reste pour les aides et la démo.
import type { ComponentChildren } from "preact";
import { uiLabel, type Catalog, type UiLabelId } from "@echo/core";

const PATHS: Record<UiLabelId, ComponentChildren> = {
  // haut-parleur
  listen: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" />
    </>
  ),
  // bulle de message
  send_sms: <path d="M4 5h16v11H9l-5 4V5z" />,
  // onde sonore → coche
  analyse: (
    <>
      <path d="M3 12h2M7 8v8M11 5v14M15 9v6" fill="none" />
      <path d="M17 13l2 2 4-5" fill="none" />
    </>
  ),
  // calendrier
  recap_month: (
    <>
      <rect x="4" y="6" width="16" height="14" rx="2" fill="none" />
      <path d="M4 10h16M8 3v5M16 3v5" fill="none" />
    </>
  ),
  // corbeille
  delete_whatsapp: (
    <>
      <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" fill="none" />
    </>
  ),
  // coche
  deleted: <path d="M5 12l5 5 9-10" fill="none" />,
};

export function Icon({ id, size = 22 }: { id: UiLabelId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
      {PATHS[id]}
    </svg>
  );
}

/**
 * Libellé en mode A : icône + kinyarwanda figé (+ anglais en petit si `gloss`). Hors mode A ou si le catalogue
 * n'a pas ce libellé : le texte anglais seul (jamais de traduction inventée).
 */
export function HostLabel({
  catalog,
  id,
  en,
  rw,
  n,
  gloss = false,
}: {
  catalog: Catalog;
  id: UiLabelId;
  en: string;
  /** true : mode A, afficher le kinyarwanda. */
  rw: boolean;
  n?: number;
  gloss?: boolean;
}) {
  const text = rw ? uiLabel(catalog, id, n) : null;
  if (!text) return <>{en}</>;
  return (
    <span class="host-label" data-testid={`rw-label-${id}`}>
      <Icon id={id} />
      <span lang="rw">{text}</span>
      {gloss && <small class="gloss-inline">{en}</small>}
    </span>
  );
}
