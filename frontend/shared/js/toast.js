const Toast = {
  container: null,

  init() {
    if (this.container) return;
    this.container = document.createElement('div');
    this.container.className = 'ep-toast-container';
    this.container.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.container);
  },

  show(message, type = 'info', durationMs = 5000) {
    this.init();
    const el = document.createElement('div');
    el.className = `ep-toast ep-toast-${type}`;
    el.textContent = message;
    el.setAttribute('role', 'alert');

    let timer;
    const dismiss = () => {
      clearTimeout(timer);
      el.remove();
    };

    timer = setTimeout(dismiss, durationMs);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => {
      timer = setTimeout(dismiss, durationMs);
    });

    this.container.appendChild(el);
    return dismiss;
  },

  success(msg) { return this.show(msg, 'success'); },
  error(msg) { return this.show(msg, 'error'); },
  warning(msg) { return this.show(msg, 'warning'); },
  info(msg) { return this.show(msg, 'info'); }
};

window.Toast = Toast;