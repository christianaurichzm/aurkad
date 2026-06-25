let musicEl: HTMLAudioElement | null = null;
let currentMusic = '';

export function playMusic(file: string): void {
  if (currentMusic === file) return;
  stopMusic();
  currentMusic = file;
  musicEl = new Audio(`/audio/${file}`);
  musicEl.loop = true;
  musicEl.volume = 0.4;
  musicEl.play().catch(() => {
    // Autoplay may be blocked until user interaction; acceptable.
  });
}

export function stopMusic(): void {
  if (musicEl) {
    musicEl.pause();
    musicEl.src = '';
    musicEl = null;
  }
  currentMusic = '';
}

export function playSound(file: string): void {
  const el = new Audio(`/audio/${file}`);
  el.volume = 0.6;
  el.play().catch(() => {});
}
