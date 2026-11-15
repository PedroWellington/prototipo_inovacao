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
