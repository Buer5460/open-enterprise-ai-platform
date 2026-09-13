(() => {
  const track = document.getElementById('track');
  if (!track) return;

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const states = new WeakMap();

  function removeWhiteBackground(src) {
    return new Promise((resolve) => {
      if (!src || !src.startsWith('data:image/')) return resolve(src);
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(image, 0, 0);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const pixels = data.data;
          let minX = canvas.width;
          let minY = canvas.height;
          let maxX = -1;
          let maxY = -1;

          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            if (r > 242 && g > 242 && b > 242) pixels[i + 3] = 0;
            if (!pixels[i + 3]) continue;
            const index = i / 4;
            const x = index % canvas.width;
            const y = Math.floor(index / canvas.width);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }

          if (maxX < minX || maxY < minY) return resolve(src);
          ctx.putImageData(data, 0, 0);

          const output = document.createElement('canvas');
          output.width = 360;
          output.height = 220;
          const out = output.getContext('2d');
          const cropW = maxX - minX + 1;
          const cropH = maxY - minY + 1;
          const pad = 22;
          const scale = Math.min((output.width - pad * 2) / cropW, (output.height - pad * 2) / cropH);
          const dw = cropW * scale;
          const dh = cropH * scale;
          out.drawImage(canvas, minX, minY, cropW, cropH, (output.width - dw) / 2, (output.height - dh) / 2, dw, dh);
          resolve(output.toDataURL('image/png'));
        } catch {
          resolve(src);
        }
      };
      image.onerror = () => resolve(src);
      image.src = src;
    });
  }

  function makePart(className, src) {
    const part = document.createElement('div');
    part.className = `horse-motion-part ${className}`;
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.draggable = false;
    part.appendChild(img);
    return part;
  }

  async function upgradeCustomHorse(runner, original) {
    const src = await removeWhiteBackground(original.src);
    if (!runner.isConnected || runner.dataset.motionReady === '1') return;

    const puppet = document.createElement('div');
    puppet.className = 'horse-motion-puppet custom';

    const shadow = document.createElement('div');
    shadow.className = 'horse-motion-shadow';
    puppet.appendChild(shadow);
    puppet.appendChild(makePart('tail', src));
    puppet.appendChild(makePart('rear-legs', src));
    puppet.appendChild(makePart('body', src));
    puppet.appendChild(makePart('front-legs', src));
    puppet.appendChild(makePart('head', src));

    original.replaceWith(puppet);
    runner.classList.add('motion-ready');
    runner.dataset.motionReady = '1';
    states.set(runner, { lastX: readX(runner), lastTime: performance.now() });
  }

  function upgradeEmojiHorse(runner, emoji) {
    if (runner.dataset.motionReady === '1') return;
    const puppet = document.createElement('div');
    puppet.className = 'horse-motion-puppet emoji';
    const shadow = document.createElement('div');
    shadow.className = 'horse-motion-shadow';
    const symbol = document.createElement('span');
    symbol.className = 'horse-motion-emoji';
    symbol.textContent = emoji.textContent || '🐎';
    puppet.append(shadow, symbol);
    emoji.replaceWith(puppet);
    runner.classList.add('motion-ready');
    runner.dataset.motionReady = '1';
    states.set(runner, { lastX: readX(runner), lastTime: performance.now() });
  }

  function upgradeRunner(runner) {
    if (!(runner instanceof HTMLElement) || !runner.classList.contains('runner') || runner.dataset.motionReady === '1') return;
    const image = [...runner.children].find((el) => el.tagName === 'IMG');
    if (image) {
      upgradeCustomHorse(runner, image);
      return;
    }
    const emoji = [...runner.children].find((el) => el.classList?.contains('emoji'));
    if (emoji) upgradeEmojiHorse(runner, emoji);
  }

  function scan() {
    track.querySelectorAll('.runner').forEach(upgradeRunner);
  }

  function readX(runner) {
    const value = runner.style.transform || '';
    const match = value.match(/translateX\(([-\d.]+)px\)/);
    return match ? Number(match[1]) : 0;
  }

  function tick(now) {
    track.querySelectorAll('.runner.motion-ready').forEach((runner) => {
      const x = readX(runner);
      let state = states.get(runner);
      if (!state) {
        state = { lastX: x, lastTime: now };
        states.set(runner, state);
      }
      const dt = Math.max(8, now - state.lastTime);
      const dx = Math.max(0, x - state.lastX);
      const pxPerMs = dx / dt;
      const moving = pxPerMs > 0.002;
      const speed = moving ? clamp(pxPerMs * 34, 0.18, 1) : 0.12;
      const stride = 0.39 - speed * 0.22;
      const bob = 2 + speed * 6;
      const lean = -2 + speed * 10;
      const squash = 0.985 + speed * 0.055;

      runner.style.setProperty('--horse-stride', `${stride.toFixed(3)}s`);
      runner.style.setProperty('--horse-bob', `${bob.toFixed(2)}px`);
      runner.style.setProperty('--horse-lean', `${lean.toFixed(2)}deg`);
      runner.style.setProperty('--horse-squash', squash.toFixed(3));
      runner.classList.toggle('horse-moving', moving);

      state.lastX = x;
      state.lastTime = now;
    });
    requestAnimationFrame(tick);
  }

  new MutationObserver(scan).observe(track, { childList: true, subtree: true });
  scan();
  requestAnimationFrame(tick);
})();
