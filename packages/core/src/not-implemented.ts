/** Marqueur des fonctions du squelette pas encore écrites (remplacées par l'agent du cœur). */
export function notImplemented(name: string): never {
  throw new Error(`@echo/core: ${name} is not implemented yet`);
}
