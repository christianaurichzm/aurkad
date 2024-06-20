export const keys: { [key: string]: boolean } = {};

export function handleInput() {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    keys[e.key] = true;
  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    keys[e.key] = false;
  });
}
