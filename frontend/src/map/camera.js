// Câmera com mola única (ideia do protótipo de design, refeita para o MapLibre): o zoom anda em escala
// logarítmica e o deslocamento encolhe na mesma proporção que a largura da vista. Assim, numa aproximação
// grande (Brasil -> bairro), o destino entra na vista cedo e nunca sai dela; sem o "salto" de um pan linear.
// Unidades: x, y em coordenadas Mercator (0..1) e zoom do MapLibre (largura da vista ~ 2^-zoom).

const TAU = 285; // ms: constante de tempo da mola (mesma sensação a 60, 120 ou 144 Hz)

// Um passo da câmera. dt em ms. Devolve a nova câmera e se ela já chegou ao destino.
export function cameraStep(cam, goal, dt) {
  const alpha = 1 - Math.exp(-Math.min(64, dt) / TAU);
  const zoom = cam.zoom + (goal.zoom - cam.zoom) * alpha; // linear no zoom = logarítmico na largura
  let { x, y } = cam;
  const w0 = 2 ** -cam.zoom, w1 = 2 ** -zoom, wg = 2 ** -goal.zoom;
  if (Math.abs(w0 - wg) > 1e-12) {
    // O deslocamento restante acompanha a largura restante: (w1 - wg) / (w0 - wg) vai de 1 a 0.
    const ratio = Math.min(1, Math.max(0, (w1 - wg) / (w0 - wg)));
    x = goal.x + (x - goal.x) * ratio;
    y = goal.y + (y - goal.y) * ratio;
  } else {
    x += (goal.x - x) * alpha;
    y += (goal.y - y) * alpha;
  }
  // Chegou: menos de 1/4 de pixel de diferença numa tela de 2048 px no zoom do destino.
  const eps = 2 ** -goal.zoom / 8192;
  const done = Math.abs(zoom - goal.zoom) < 0.002 && Math.abs(x - goal.x) < eps && Math.abs(y - goal.y) < eps;
  return done ? { cam: { ...goal }, done } : { cam: { x, y, zoom }, done };
}

// cubic-bezier do CSS em JS (Newton + bissecção), para animar câmera e holograma com a mesma curva dos tokens.
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const e = sx(t) - x, d = dx(t);
      if (Math.abs(e) < 1e-6) return sy(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}
export const ease = cubicBezier(0.22, 1, 0.36, 1); // --ease-spring
