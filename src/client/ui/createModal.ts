type ModalOptions = {
  title: string;
  content: HTMLElement | string;
  footer?: HTMLElement | string;
  onClose?: () => void;
  width?: number | string;
};

export function createModal(options: ModalOptions) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const container = document.createElement('div');
  container.className = 'modal-container';
  container.style.width =
    typeof options.width === 'number'
      ? `${options.width}px`
      : options.width || '500px';

  const titleBar = document.createElement('div');
  titleBar.className = 'modal-titlebar';

  const titleEl = document.createElement('h2');
  titleEl.className = 'modal-title';
  titleEl.textContent = options.title;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close-btn';
  closeBtn.textContent = 'x';
  closeBtn.onclick = close;

  titleBar.appendChild(titleEl);
  titleBar.appendChild(closeBtn);

  const contentEl = document.createElement('div');
  contentEl.className = 'modal-content';
  if (typeof options.content === 'string') {
    contentEl.innerHTML = options.content;
  } else {
    contentEl.appendChild(options.content);
  }

  const footerEl = document.createElement('div');
  footerEl.className = 'modal-footer';
  if (options.footer) {
    if (typeof options.footer === 'string') {
      footerEl.innerHTML = options.footer;
    } else {
      footerEl.appendChild(options.footer);
    }
  }

  container.appendChild(titleBar);
  container.appendChild(contentEl);
  if (options.footer) container.appendChild(footerEl);

  document.body.appendChild(overlay);
  document.body.appendChild(container);

  makeDraggable(container, titleBar);

  function close() {
    document.body.removeChild(overlay);
    document.body.removeChild(container);
    options.onClose?.();
  }

  return { close };
}

function makeDraggable(el: HTMLElement, dragHandle: HTMLElement) {
  let dragging = false,
    offsetX = 0,
    offsetY = 0;

  dragHandle.addEventListener('mousedown', (e) => {
    dragging = true;
    offsetX = e.clientX - el.offsetLeft;
    offsetY = e.clientY - el.offsetTop;
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    el.style.left = `${e.clientX - offsetX}px`;
    el.style.top = `${e.clientY - offsetY}px`;
    el.style.transform = 'none';
  });

  document.addEventListener('mouseup', () => {
    dragging = false;
    document.body.style.userSelect = '';
  });
}
