// Tema claro/escuro da landing e do app (servido em /app/theme.js; a landing também o carrega).
// Script clássico e bloqueante no <head>: aplica a preferência antes da primeira pintura (sem flash do tema
// errado) e expõe window.vicusTheme. A CSP (script-src 'self') não permite script inline, por isso é um arquivo.
// Preferência: localStorage('theme'); sem ela, a do sistema. Botões com [data-theme-toggle] alternam com a
// transição em círculo (View Transitions API); com movimento reduzido ou sem suporte, troca na hora.
(function () {
  var KEY = 'theme';
  var root = document.documentElement;
  var system = matchMedia('(prefers-color-scheme: dark)');
  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function current() { return stored() || (system.matches ? 'dark' : 'light'); }
  function apply(t) {
    root.dataset.theme = t;
    root.style.colorScheme = t;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#181512' : '#20272d';
    root.dispatchEvent(new CustomEvent('themechange', { detail: t }));
  }
  apply(current());
  system.addEventListener('change', function () { if (!stored()) apply(current()); });
  // Aparelho lento troca na hora, sem o círculo: a captura da página inteira custa um quadro longo.
  // Lento = poucos núcleos ou pouca memória, ou um microteste de CPU (~1,7 ms num desktop comum) acima de 4 ms.
  // Medido uma vez, no primeiro clique (docs/PERFORMANCE.md, "Fase 9 fechada").
  var slowCache = null;
  function slow() {
    if (slowCache !== null) return slowCache;
    var cores = navigator.hardwareConcurrency || 8, mem = navigator.deviceMemory || 8;
    var t0 = performance.now(), acc = 0;
    for (var i = 0; i < 5e4; i++) acc += Math.sqrt(i) * Math.sin(i);
    slowCache = cores <= 4 || mem <= 4 || performance.now() - t0 > 4 || acc !== acc;
    return slowCache;
  }
  function set(t, x, y) {
    try { localStorage.setItem(KEY, t); } catch (e) { /* sem armazenamento: vale só nesta página */ }
    var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduced || x == null || slow()) return apply(t);
    var r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(function () { apply(t); }).ready.then(function () {
      root.animate(
        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + r + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 550, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!b) return;
    var box = b.getBoundingClientRect(); // teclado: o círculo parte do centro do botão
    set(current() === 'dark' ? 'light' : 'dark', box.left + box.width / 2, box.top + box.height / 2);
  });
  window.vicusTheme = { get: current, set: set };
})();
