import Phaser from "phaser";

/** Every match sound, keyed by file basename under `/assets/audio`. All CC0 — see `docs/asset-credits.md`. */
export const SFX_KEYS = [
  "dash",
  "hit",
  "wall",
  "break",
  "ko",
  "ougi-ember",
  "ougi-gale",
  "ougi-shade",
  "countdown",
  "match-start",
  "match-end",
] as const;

export type SfxKey = (typeof SFX_KEYS)[number];

/** Absolute so the paths still resolve from `/r/<code>`, which is a real URL the client is served at. */
const AUDIO_PATH = "/assets/audio";

export function preloadSfx(loader: Phaser.Loader.LoaderPlugin): void {
  for (const key of SFX_KEYS) loader.audio(key, `${AUDIO_PATH}/${key}.ogg`);
}

/** Impacts fire in bursts, so each one is detuned a little — identical repeats read as a machine gun. */
export function playSfx(scene: Phaser.Scene, key: SfxKey, volume = 1, vary = true): void {
  if (!scene.cache.audio.has(key)) return;
  scene.sound.play(key, {
    volume: Phaser.Math.Clamp(volume, 0, 1),
    detune: vary ? Phaser.Math.Between(-120, 120) : 0,
  });
}

/** The Ougi sound is the character's signature, so each one gets its own file. */
export function ougiSfxKey(characterId: string): SfxKey {
  const key = `ougi-${characterId}` as SfxKey;
  return SFX_KEYS.includes(key) ? key : "ougi-ember";
}

/**
 * Lobby SFX play before Phaser exists (the game boots only once a match starts), so they go through plain
 * HTMLAudio rather than the scene's sound manager.
 */
export function playUiSfx(name: "select"): void {
  const audio = new Audio(`${AUDIO_PATH}/${name}.ogg`);
  audio.volume = 0.4;
  // Autoplay is blocked until the user has interacted with the page; a rejected play is not worth surfacing.
  void audio.play().catch(() => {});
}
