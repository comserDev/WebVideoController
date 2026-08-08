(() => {
  'use strict';

  const api = globalThis.browser || globalThis.chrome;
  const videoCount = document.getElementById('videoCount');
  const controllerState = document.getElementById('controllerState');
  const message = document.getElementById('message');
  const refreshBtn = document.getElementById('refreshBtn');
  const copyBtn = document.getElementById('copyBtn');
  let lastReport = '';

  function setMessage(text, kind = '') {
    message.textContent = text;
    message.className = `message${kind ? ` ${kind}` : ''}`;
  }

  function tabsQuery(query) {
    return new Promise((resolve) => {
      try {
        const result = api.tabs.query(query, resolve);
        if (result && typeof result.then === 'function') result.then(resolve).catch(() => resolve([]));
      } catch (_) {
        resolve([]);
      }
    });
  }

  function send(tabId, type) {
    return new Promise((resolve) => {
      try {
        const callback = (response) => {
          const err = globalThis.chrome?.runtime?.lastError;
          if (err) return resolve(null);
          resolve(response || null);
        };
        const result = api.tabs.sendMessage(tabId, { type }, callback);
        if (result && typeof result.then === 'function') result.then(resolve).catch(() => resolve(null));
      } catch (_) {
        resolve(null);
      }
    });
  }

  function renderUnavailable() {
    videoCount.textContent = '-';
    controllerState.textContent = '확인 불가';
    lastReport = '';
    setMessage('이 페이지에서는 상태를 확인할 수 없습니다. 일반 웹페이지에서 다시 확인해 주세요.', 'error');
  }

  function render(response) {
    const summary = response?.summary;
    if (!response?.ok || !summary) {
      renderUnavailable();
      return;
    }

    const count = Number(summary.videos || 0);
    videoCount.textContent = `${count}개`;
    controllerState.textContent = '정상 동작';
    lastReport = response.report || '';
    setMessage(count > 0 ? '비디오 컨트롤러가 정상적으로 동작하고 있습니다.' : '현재 페이지에서 HTML5 비디오가 감지되지 않았습니다.', 'success');
  }

  async function load(type = 'WVC_DEBUG_GET') {
    setMessage('현재 페이지 상태를 확인하고 있습니다.');
    const tabs = await tabsQuery({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) {
      renderUnavailable();
      return;
    }

    const response = await send(tab.id, type);
    render(response);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      } catch (_) {
        return false;
      }
    }
  }

  refreshBtn.addEventListener('click', () => load('WVC_DEBUG_REFRESH'));
  copyBtn.addEventListener('click', async () => {
    if (!lastReport) {
      setMessage('복사할 진단 정보가 없습니다.', 'error');
      return;
    }
    const ok = await copyText(lastReport);
    setMessage(ok ? '진단 정보를 복사했습니다.' : '진단 정보를 복사하지 못했습니다.', ok ? 'success' : 'error');
  });

  load();
})();
