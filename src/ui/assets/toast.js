function toast(message, kind = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end';
    document.body.appendChild(container);
  }

  const colors = {
    success: 'bg-green-700',
    error: 'bg-red-700',
  };

  const el = document.createElement('div');
  el.className = `${colors[kind] || colors.success} text-white text-sm rounded-lg px-4 py-2 shadow-lg opacity-0 translate-y-2 transition-all duration-200`;
  el.textContent = message;
  container.appendChild(el);

  requestAnimationFrame(() => {
    el.classList.remove('opacity-0', 'translate-y-2');
  });

  setTimeout(() => {
    el.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => el.remove(), 200);
  }, 3000);
}
