/** Pequenos intervalos entre chamadas ao WPP para parecer uso humano (não elimina risco de ban). */
let lastCallAt = 0;

export async function wppHumanDelay(): Promise<void> {
  if (process.env.WPP_HUMANIZE === "false") return;
  const minGap = 280;
  const now = Date.now();
  const jitter = 80 + Math.floor(Math.random() * 220);
  const wait = Math.max(0, minGap - (now - lastCallAt)) + jitter;
  lastCallAt = Date.now() + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
