/** Declared by hand rather than via `vite/client`, since this package pins `types: []` to keep DOM-only lib. */
interface ImportMetaEnv {
  /** Colyseus server URL for a deployed build, e.g. `wss://ougi-arena.onrender.com`. Unset in dev. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
