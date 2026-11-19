// Vídeo "como funciona": o iframe (e com ele a animação e a narração) só existe com o modal aberto.
const open = document.getElementById('videoOpen');
const dlg = document.getElementById('videoModal');
let frame = null;

open?.addEventListener('click', () => {
  frame = document.createElement('iframe');
  frame.className = 'video-frame';
  // Vídeo do tema da hora em que o modal abre (trocar o tema com ele aberto vale só na próxima abertura).
  const dark = document.documentElement.dataset.theme === 'dark';
  frame.src = `/video/${dark ? 'escuro' : 'index'}.html?embed=1&auto=1`;
  frame.allow = 'autoplay';
  frame.title = 'Vídeo: como o VICUS funciona';
  // Esc com o foco dentro do iframe não chega ao <dialog>; mesma origem, então escutamos lá dentro.
  frame.addEventListener('load', () => frame?.contentWindow?.addEventListener('keydown', (e) => e.key === 'Escape' && dlg.close()));
  dlg.querySelector('.video-note').before(frame);
  dlg.showModal(); // Esc nativo, resto da página inerte (foco preso no modal)
  dlg.querySelector('.video-close').focus();
});
dlg?.querySelector('.video-close').addEventListener('click', () => dlg.close());
dlg?.addEventListener('click', (e) => e.target === dlg && dlg.close()); // clique fora do vídeo
dlg?.addEventListener('close', () => {
  frame?.remove(); // para som e animação
  frame = null;
  open.focus();
});
