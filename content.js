/**
 * 웹(AAGAG) 비디오 컨트롤러 1.3.0
 *
 * HTML5 video에 재생/배속 컨트롤을 붙인다.
 * 기본 원칙은 '영상 바로 아래 + 영상 너비와 동일한 인라인 바'이다.
 * 사이트 자체 컨트롤러가 영상 위에 있더라도 겹치지 않도록 영상 밖에 배치한다.
 *
 * DOM 구조상 안전한 인라인 삽입 위치를 찾기 어려운 경우에만
 * 실제 화면에 렌더링된 video의 하단 좌표를 따라가는 폴백을 사용한다.
 * 복잡한 VOD 플레이어(iMBC 등)를 위해 조상 컨테이너를 점수화하여 탐색한다.
 */

(() => {
  'use strict';

  // 대상 영상 필터. 너무 작은 <video>까지 잡으면 광고·썸네일·움짤에 UI가 붙는다.
  // 데스크톱 150×100px은 일반 게시물 내 소형 미디어를 거르면서 실제 플레이어는 놓치지 않는 하한이다.
  const DESKTOP_MIN_WIDTH = 150;
  const DESKTOP_MIN_HEIGHT = 100;

  // 모바일은 화면 자체가 작으므로 절대 크기 기준을 낮춘다.
  // 대신 아래의 viewport 비율 조건을 함께 적용해 작은 장식용 video가 통과하지 않게 한다.
  const MOBILE_MIN_WIDTH = 100;
  const MOBILE_MIN_HEIGHT = 80;
  const MOBILE_MIN_WIDTH_RATIO = 0.5;   // 화면 너비의 절반 이상이면 주 콘텐츠일 가능성이 높다.
  const MOBILE_MIN_AREA_RATIO = 0.08;   // 화면 면적의 8% 이상이면 세로형/비정형 플레이어도 허용한다.

  // 사용자가 직접 터치한 영상은 의도가 명확하므로 필터를 완화한다.
  // 80×45는 16:9 기준으로도 조작 UI를 붙일 수 있는 현실적인 최소 크기다.
  const ACTIVATED_MIN_WIDTH = 80;
  const ACTIVATED_MIN_HEIGHT = 45;

  // 기본 슬라이더 상한. 3.0x면 일반적인 학습/탐색 용도는 충분히 커버한다.
  // 사이트가 이미 3.0x를 넘는 playbackRate를 사용 중이면 해당 값을 보존하도록 UI에서 동적으로 확장한다.
  const DEFAULT_MAX_RATE = 3.0;

  // 플레이어 셸 판별 허용치. 사이트별 border/padding 때문에 video와 부모 폭이 정확히 같지 않다.
  // 32px 또는 12%까지는 플레이어 크롬(chrome)으로 보고, 그 이상은 페이지 레이아웃일 가능성이 높아 제외한다.
  const INLINE_WIDTH_TOLERANCE = 32;
  const INLINE_WIDTH_RATIO_LIMIT = 1.12;

  // 자막·자체 컨트롤·포스터 레이어를 포함한 셸은 video보다 조금 높을 수 있다.
  // 2.25배를 넘으면 카드/본문 컨테이너를 플레이어로 오인할 가능성이 커진다.
  const INLINE_HEIGHT_RATIO_LIMIT = 2.25;

  // iMBC/커뮤니티 플레이어는 래퍼가 5~7단계인 경우가 흔하다.
  // 9단계면 충분히 탐색하면서도 document 전체 레이아웃까지 올라갈 가능성을 제한할 수 있다.
  const MAX_CONTAINER_DEPTH = 9;

  // id/class 이름에 아래 단어가 있으면 플레이어 전용 래퍼일 가능성에 가산점을 준다.
  const PLAYER_HINT_RE = /(player|video|media|vod|movie|clip|stream|contents?)/i;

  // 아래 태그 안에 div/button 기반 컨트롤러를 직접 삽입하면 HTML 의미가 깨지거나
  // 원래 클릭 이벤트를 가로챌 수 있다. 이런 부모에서는 한 단계 바깥의 안전한 위치를 찾는다.
  const UNSAFE_PARENT_TAGS = new Set([
    'a', 'button', 'label', 'p', 'span', 'em', 'strong', 'small',
    'table', 'tbody', 'thead', 'tfoot', 'tr', 'select', 'option'
  ]);

  // video 노드별 런타임 상태. WeakMap을 써서 video가 DOM에서 제거되면 GC를 방해하지 않는다.
  const videoStateMap = new WeakMap();

  // 위치 재계산이 필요한 현재 활성 video만 추적한다. Set은 requestAnimationFrame 배치 루프에서 순회하기 편하다.
  const trackedVideos = new Set();

  // 같은 프레임에서 resize/scroll 이벤트가 여러 번 와도 레이아웃 계산은 한 번만 수행한다.
  let layoutFramePending = false;
  // DOM mutation이 연속 발생할 때 cleanup을 중복 예약하지 않기 위한 플래그다.
  let cleanupScheduled = false;

  // 아래 debug* 변수는 진단 정보 생성 상태를 관리한다. 페이지에 상시 버튼은 표시하지 않고
  // popup.js가 메시지로 보고서를 요청할 때 동일한 데이터 모델을 재사용한다.
  let debugEnabled = false;
  let debugRoot = null;
  let debugPanel = null;
  let debugToggle = null;
  let debugRefreshPending = false;
  let debugSequence = 0;



  // ---------------------------------------------------------------------------
  // 모바일 디버그 모드 (강화판)
  // ---------------------------------------------------------------------------

  function elementLabel(element) {
    if (!(element instanceof Element)) return '-';
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    let cls = '';
    if (typeof element.className === 'string' && element.className.trim()) {
      cls = '.' + element.className.trim().split(/\s+/).slice(0, 3).join('.');
    }
    return `${tag}${id}${cls}`.slice(0, 110);
  }

  function elementPath(element) {
    if (!(element instanceof Element)) return '-';
    const parts = [];
    let current = element;
    for (let depth = 0; current && depth < 6; depth += 1) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${current.id}`;
        parts.unshift(part);
        break;
      }
      if (typeof current.className === 'string' && current.className.trim()) {
        part += '.' + current.className.trim().split(/\s+/).slice(0, 2).join('.');
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ').slice(-320);
  }

  function sanitizeSourceForDebug(value) {
    if (!value) return '-';
    try {
      const url = new URL(value, location.href);
      return `${url.origin}${url.pathname}`.slice(0, 220);
    } catch (_) {
      return String(value).slice(0, 220);
    }
  }

  function formatCandidate(candidate) {
    if (!candidate) return '-';
    const score = Number.isFinite(candidate.score) ? candidate.score.toFixed(1) : String(candidate.score);
    return `d${candidate.depth} ${score} ${candidate.label}`;
  }

  function getVideoDebugData(videoEl, state) {
    const rect = videoEl.getBoundingClientRect();
    const gifLike = isGifLikeVideo(videoEl, state);
    const shell = state?.debugShell || state?.inlineAnchor || null;
    const rate = Number.isFinite(videoEl.playbackRate) ? videoEl.playbackRate : 1;
    return {
      id: state?.debugId || '?',
      size: `${Math.round(rect.width)}×${Math.round(rect.height)}`,
      type: gifLike ? 'GIF형' : 'VIDEO',
      mode: state?.mode || (gifLike ? 'hidden' : '대기'),
      rate: `${rate.toFixed(1)}×`,
      shell: elementLabel(shell),
      path: elementPath(videoEl),
      reason: state?.debugReason || '-',
      controls: videoEl.controls ? 'yes' : 'no',
      autoplay: videoEl.autoplay ? 'yes' : 'no',
      muted: videoEl.muted ? 'yes' : 'no',
      loop: videoEl.loop ? 'yes' : 'no',
      activated: state?.userActivated ? 'yes' : 'no',
      source: sanitizeSourceForDebug(videoEl.currentSrc || videoEl.src),
      candidates: Array.isArray(state?.debugCandidates) ? state.debugCandidates.slice(0, 5) : []
    };
  }

  function createTextLine(className, text) {
    const line = document.createElement('div');
    line.className = className;
    line.textContent = text;
    return line;
  }

  function buildDebugReport() {
    const videos = [...document.querySelectorAll('video')];
    const lines = [
      'Web Video Controller 1.3.0 DEBUG REPORT',
      `time: ${new Date().toISOString()}`,
      `url: ${location.origin}${location.pathname}`,
      `frame: ${isEmbeddedFrame() ? 'iframe' : 'top'}`,
      `viewport: ${window.innerWidth}x${window.innerHeight}`,
      `visualViewport: ${window.visualViewport ? `${Math.round(window.visualViewport.width)}x${Math.round(window.visualViewport.height)} scale=${window.visualViewport.scale}` : '-'}`,
      `touchLayout: ${isTouchLayout()}`,
      `fullscreen: ${Boolean(document.fullscreenElement)}`,
      `videos: ${videos.length}`,
      `ua: ${navigator.userAgent}`,
      ''
    ];

    videos.forEach((videoEl, index) => {
      let state = videoStateMap.get(videoEl);
      if (!state) {
        state = { debugId: ++debugSequence };
        videoStateMap.set(videoEl, state);
      }
      const d = getVideoDebugData(videoEl, state);
      lines.push(`#${d.id} video ${index + 1}`);
      lines.push(`type=${d.type} mode=${d.mode} rate=${d.rate} size=${d.size}`);
      lines.push(`reason=${d.reason}`);
      lines.push(`controls=${d.controls} autoplay=${d.autoplay} muted=${d.muted} loop=${d.loop} activated=${d.activated}`);
      lines.push(`shell=${d.shell}`);
      lines.push(`path=${d.path}`);
      lines.push(`source=${d.source}`);
      if (d.candidates.length) {
        lines.push('shellCandidates:');
        d.candidates.forEach((candidate) => lines.push(`  ${formatCandidate(candidate)}`));
      }
      lines.push('');
    });

    return lines.join('\n');
  }

  async function copyDebugReport() {
    const report = buildDebugReport();
    try {
      await navigator.clipboard.writeText(report);
      return true;
    } catch (_) {
      try {
        const area = document.createElement('textarea');
        area.value = report;
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

  function ensureDebugUI() {
    if (debugRoot?.isConnected) return;

    debugRoot = document.createElement('div');
    debugRoot.className = 'wvc-debug-root';
    debugRoot.setAttribute('data-wvc-internal', 'debug');

    debugToggle = document.createElement('button');
    debugToggle.type = 'button';
    debugToggle.className = 'wvc-debug-toggle';
    debugToggle.textContent = 'DBG';
    debugToggle.title = 'Web Video Controller 디버그 모드';

    debugPanel = document.createElement('div');
    debugPanel.className = 'wvc-debug-panel';

    debugToggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      debugEnabled = !debugEnabled;
      renderDebugPanel();
    });

    debugRoot.append(debugPanel, debugToggle);
    (document.documentElement || document.body).appendChild(debugRoot);
    renderDebugPanel();
  }

  function renderDebugPanel() {
    ensureDebugUI();
    debugRoot.classList.toggle('wvc-debug-enabled', debugEnabled);
    debugToggle.textContent = debugEnabled ? 'DBG ✓' : 'DBG';
    debugToggle.setAttribute('aria-pressed', String(debugEnabled));

    if (!debugEnabled) {
      debugPanel.replaceChildren();
      return;
    }

    const videos = [...document.querySelectorAll('video')];
    const header = document.createElement('div');
    header.className = 'wvc-debug-header';

    const title = createTextLine('wvc-debug-title', `WVC 1.3.0 · ${videos.length} video · ${isEmbeddedFrame() ? 'iframe' : 'top'}`);
    const env = createTextLine('wvc-debug-env', `${location.hostname || 'local'} · ${window.innerWidth}×${window.innerHeight} · touch:${isTouchLayout() ? 'Y' : 'N'}`);

    const actions = document.createElement('div');
    actions.className = 'wvc-debug-actions';

    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.textContent = '새로고침';
    refreshButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.querySelectorAll('video').forEach(attachControllerToVideo);
      renderDebugPanel();
    });

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = '보고서 복사';
    copyButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const original = copyButton.textContent;
      const ok = await copyDebugReport();
      copyButton.textContent = ok ? '복사됨 ✓' : '복사 실패';
      window.setTimeout(() => { copyButton.textContent = original; }, 1400);
    });

    actions.append(refreshButton, copyButton);
    header.append(title, env, actions);

    const host = document.createElement('div');
    host.className = 'wvc-debug-list';

    if (videos.length === 0) {
      host.appendChild(createTextLine('wvc-debug-empty', '감지된 <video> 없음'));
    } else {
      videos.slice(0, 12).forEach((videoEl) => {
        let state = videoStateMap.get(videoEl);
        if (!state) {
          state = { debugId: ++debugSequence };
          videoStateMap.set(videoEl, state);
        }
        if (!state.debugId) state.debugId = ++debugSequence;
        const d = getVideoDebugData(videoEl, state);
        const row = document.createElement('div');
        row.className = 'wvc-debug-row';

        row.appendChild(createTextLine('wvc-debug-primary', `#${d.id} ${d.type} · ${d.size} · ${d.mode} · ${d.rate}`));
        row.appendChild(createTextLine('wvc-debug-reason', `reason: ${d.reason}`));
        row.appendChild(createTextLine('wvc-debug-detail', `controls:${d.controls} auto:${d.autoplay} muted:${d.muted} loop:${d.loop} touched:${d.activated}`));
        row.appendChild(createTextLine('wvc-debug-detail', `shell: ${d.shell}`));
        row.appendChild(createTextLine('wvc-debug-detail', `path: ${d.path}`));
        if (d.candidates.length) {
          row.appendChild(createTextLine('wvc-debug-detail', `candidates: ${d.candidates.map(formatCandidate).join(' | ')}`));
        }
        host.appendChild(row);
      });

      if (videos.length > 12) {
        host.appendChild(createTextLine('wvc-debug-empty', `외 ${videos.length - 12}개 video · 전체 내용은 보고서 복사 사용`));
      }
    }

    debugPanel.replaceChildren(header, host);
  }

  function scheduleDebugRefresh() {
    if (!debugEnabled || debugRefreshPending) return;
    debugRefreshPending = true;
    window.requestAnimationFrame(() => {
      debugRefreshPending = false;
      renderDebugPanel();
    });
  }

  // ---------------------------------------------------------------------------
  // 환경 / 대상 판별
  // ---------------------------------------------------------------------------

  function isYouTube(videoEl = null) {
    const hostname = window.location.hostname;
    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) return true;
    // Playground/테스트 문서에서도 실제 YouTube 배치 로직을 그대로 검증할 수 있게 한다.
    return Boolean(videoEl?.closest?.('[data-wvc-site="youtube"]'));
  }

  function isEmbeddedFrame() {
    return window.self !== window.top;
  }

  function shouldUseEmbeddedFrameMode(videoEl) {
    if (!isEmbeddedFrame()) return false;
    if (isYouTube(videoEl)) return true;

    // 일반 임베드도 영상이 iframe 높이를 거의 다 차지하면 아래쪽에 DOM을 추가해도
    // 부모 페이지에서는 잘려 보이기 쉽다. 이런 경우에만 내부 안전 모드로 전환한다.
    const rect = videoEl.getBoundingClientRect();
    return rect.bottom >= window.innerHeight - 56;
  }

  function isGifLikeVideo(videoEl, state = {}) {
    // 커뮤니티의 GIF/WebP -> MP4 변환 영상은 보통 autoplay + muted + loop + controls 없음이다.
    // 이런 요소는 사용자가 직접 건드리기 전까지 컨트롤러를 숨겨 게시물 UI를 어지럽히지 않는다.
    if (state.userActivated) return false;

    const autoplay = videoEl.autoplay || videoEl.hasAttribute('autoplay');
    const muted = videoEl.muted || videoEl.defaultMuted || videoEl.hasAttribute('muted');
    const loop = videoEl.loop || videoEl.hasAttribute('loop');
    const noControls = !videoEl.controls && !videoEl.hasAttribute('controls');
    const noAudio = videoEl.mozHasAudio === false || videoEl.webkitAudioDecodedByteCount === 0;

    return autoplay && muted && loop && noControls && (noAudio || videoEl.readyState < 1 || videoEl.duration === Infinity || videoEl.duration <= 90);
  }

  function isTouchLayout() {
    return window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false;
  }

  function isControllerTarget(videoEl, state = {}) {
    if (isGifLikeVideo(videoEl, state)) return false;

    const rect = videoEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    if (state.userActivated) {
      return rect.width >= ACTIVATED_MIN_WIDTH && rect.height >= ACTIVATED_MIN_HEIGHT;
    }

    if (!isTouchLayout()) {
      return rect.width >= DESKTOP_MIN_WIDTH && rect.height >= DESKTOP_MIN_HEIGHT;
    }

    const viewportWidth = Math.max(window.innerWidth, 1);
    const viewportHeight = Math.max(window.innerHeight, 1);
    const viewportArea = viewportWidth * viewportHeight;
    const videoArea = rect.width * rect.height;

    const largeByWidth = rect.width >= viewportWidth * MOBILE_MIN_WIDTH_RATIO;
    const largeByArea = videoArea >= viewportArea * MOBILE_MIN_AREA_RATIO;

    return (
      rect.width >= MOBILE_MIN_WIDTH &&
      rect.height >= MOBILE_MIN_HEIGHT &&
      (largeByWidth || largeByArea)
    );
  }

  function getVisibleRect(videoEl, state) {
    if (!videoEl.isConnected || !isControllerTarget(videoEl, state)) return null;
    return videoEl.getBoundingClientRect();
  }

  // ---------------------------------------------------------------------------
  // 컨트롤러 UI
  // ---------------------------------------------------------------------------

  function createWidgetUI(videoEl) {
    const widget = document.createElement('div');
    widget.className = 'web-speed-controller-container';
    widget.setAttribute('role', 'group');
    widget.setAttribute('aria-label', '비디오 재생 및 속도 조절');

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'web-speed-btn';

    const updatePlayButton = () => {
      const paused = videoEl.paused;
      // 화면에는 상태 아이콘만 보여 공간을 아낀다. 접근성 이름은 aria-label로 유지한다.
      playBtn.textContent = paused ? '▶' : '❚❚';
      playBtn.setAttribute('aria-label', paused ? '비디오 재생' : '비디오 일시정지');
      playBtn.title = paused ? '재생' : '일시정지';
    };

    updatePlayButton();
    videoEl.addEventListener('play', updatePlayButton);
    videoEl.addEventListener('pause', updatePlayButton);
    videoEl.addEventListener('ended', updatePlayButton);

    playBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (videoEl.paused) {
        const playResult = videoEl.play();
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(updatePlayButton);
        }
      } else {
        videoEl.pause();
      }
    });

    const sliderGroup = document.createElement('div');
    sliderGroup.className = 'web-speed-slider-group';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'web-speed-slider';
    // 0.1x는 브라우저가 허용하는 HTMLMediaElement playbackRate 범위 안에서
    // 프레임 단위 확인/언어 학습처럼 극저속 재생이 필요한 사용 사례를 지원하기 위한 하한이다.
    // 0.1 단위는 모바일 슬라이더에서도 값 선택이 과도하게 촘촘해지지 않는 절충값이다.
    slider.min = '0.1';
    slider.step = '0.1';
    slider.setAttribute('aria-label', '비디오 재생 속도');

    const speedText = document.createElement('span');
    speedText.className = 'web-speed-text';

    const syncRateUI = () => {
      const rate = Number.isFinite(videoEl.playbackRate) ? videoEl.playbackRate : 1;
      const maxRate = Math.max(DEFAULT_MAX_RATE, Math.ceil(rate * 10) / 10);
      slider.max = String(maxRate);
      slider.value = String(Math.max(0.1, rate));
      speedText.textContent = `${rate.toFixed(1)}x`;
      slider.setAttribute('aria-valuetext', `${rate.toFixed(1)}배속`);
    };

    syncRateUI();

    slider.addEventListener('input', (event) => {
      const newRate = Number.parseFloat(event.target.value);
      if (!Number.isFinite(newRate)) return;

      videoEl.playbackRate = newRate;
      speedText.textContent = `${newRate.toFixed(1)}x`;
      slider.setAttribute('aria-valuetext', `${newRate.toFixed(1)}배속`);
    });

    videoEl.addEventListener('ratechange', () => { syncRateUI(); scheduleDebugRefresh(); });

    for (const eventName of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
      widget.addEventListener(eventName, (event) => event.stopPropagation());
    }

    sliderGroup.append(slider, speedText);
    widget.append(playBtn, sliderGroup);
    return widget;
  }

  function ensureWidget(videoEl, state) {
    if (!state.widget) state.widget = createWidgetUI(videoEl);
    return state.widget;
  }

  function setWidgetWidth(widget, width) {
    // 120px 미만에서는 재생 버튼·슬라이더·배속 텍스트를 한 줄에 유지하기 어렵다.
    // 실제 video가 더 작더라도 컨트롤러 자체의 최소 조작성은 보장한다.
    const safeWidth = Math.max(120, Math.round(width));
    widget.style.setProperty('width', `${safeWidth}px`, 'important');
    widget.style.setProperty('max-width', `${safeWidth}px`, 'important');
    widget.classList.toggle('web-speed-compact', safeWidth < 320);
  }

  // ---------------------------------------------------------------------------
  // YouTube: 영상 아래 / 메타데이터 위
  // ---------------------------------------------------------------------------

  function getYouTubeTarget(videoEl = null) {
    const simulated = videoEl?.closest?.('[data-wvc-site="youtube"]');
    if (simulated) {
      return simulated.querySelector('[data-wvc-youtube-target], #above-the-fold, ytd-watch-metadata, #title, #below');
    }
    return document.querySelector(
      '#below #above-the-fold, #below ytd-watch-metadata, #below #title, #below, ytd-watch-metadata'
    );
  }

  function attachYouTubeController(videoEl, state) {
    const target = getYouTubeTarget(videoEl);
    const rect = getVisibleRect(videoEl, state);
    if (!target || !target.parentNode || !rect) return false;

    const widget = ensureWidget(videoEl, state);
    widget.className = 'web-speed-controller-container web-speed-inline';
    setWidgetWidth(widget, rect.width);

    if (widget.parentNode !== target.parentNode || widget.nextSibling !== target) {
      target.parentNode.insertBefore(widget, target);
    }

    state.mode = 'inline';
    state.debugReason = `YouTube target: ${elementLabel(target)}`;
    state.debugShell = target;
    state.inlineAnchor = target;
    state.hasController = true;
    trackedVideos.add(videoEl);
    scheduleDebugRefresh();
    return true;
  }

  // ---------------------------------------------------------------------------
  // 일반 사이트: 안전한 플레이어 컨테이너를 찾아 바로 아래에 인라인 삽입
  // ---------------------------------------------------------------------------

  function isUnsafeInlineParent(element) {
    if (!element || element === document.body || element === document.documentElement) return true;
    const tag = element.tagName?.toLowerCase();
    if (UNSAFE_PARENT_TAGS.has(tag)) return true;
    if (element.closest?.('a, button, label')) return true;
    return false;
  }

  function getContainerScore(element, videoRect, depth) {
    if (!(element instanceof Element) || isUnsafeInlineParent(element)) return -Infinity;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return -Infinity;

    const containsVideo =
      rect.left <= videoRect.left + 3 &&
      rect.right >= videoRect.right - 3 &&
      rect.top <= videoRect.top + 3 &&
      rect.bottom >= videoRect.bottom - 3;
    if (!containsVideo) return -Infinity;

    const widthDelta = Math.abs(rect.width - videoRect.width);
    const widthRatio = rect.width / Math.max(videoRect.width, 1);
    const heightRatio = rect.height / Math.max(videoRect.height, 1);

    // 영상보다 지나치게 넓거나 높은 레이아웃 컨테이너는 플레이어 셸로 보지 않는다.
    if (widthDelta > INLINE_WIDTH_TOLERANCE && widthRatio > INLINE_WIDTH_RATIO_LIMIT) return -Infinity;
    if (heightRatio > INLINE_HEIGHT_RATIO_LIMIT && rect.height - videoRect.height > 180) return -Infinity;

    const style = window.getComputedStyle(element);
    const identity = `${element.id || ''} ${element.className || ''}`;
    const tag = element.tagName?.toLowerCase();

    // article/section/main 같은 콘텐츠 레이아웃 래퍼는 폭이 우연히 영상과 같아도
    // 플레이어 셸이 아니다. 단, class/id가 player/video/media/vod 등을 명시하면 허용한다.
    if (['section', 'article', 'main'].includes(tag) && !PLAYER_HINT_RE.test(identity)) return -Infinity;

    let score = 100;
    score -= Math.min(widthDelta, 100) * 1.6;
    score -= Math.max(0, rect.height - videoRect.height) * 0.12;
    score += Math.min(depth, 6) * 3; // 같은 조건이면 자체 컨트롤까지 감싸는 바깥 셸을 선호
    if (PLAYER_HINT_RE.test(identity)) score += 22;
    if (style.position === 'relative' || style.position === 'absolute') score += 5;
    if (style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden') score += 4;

    return score;
  }

  /**
   * video의 여러 단계 조상을 끝까지 비교해 실제 플레이어 셸에 가장 가까운 요소를 고른다.
   * 중간 래퍼 하나가 영상보다 넓더라도 그 위에 더 적절한 플레이어 셸이 있을 수 있으므로
   * 예전처럼 첫 실패에서 탐색을 멈추지 않는다.
   */
  function findPlayerShell(videoEl, videoRect, state = null) {
    let current = videoEl;
    let best = videoEl;
    let bestScore = 0;
    const candidates = [];

    for (let depth = 1; depth <= MAX_CONTAINER_DEPTH; depth += 1) {
      const parent = current.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;

      const score = getContainerScore(parent, videoRect, depth);
      candidates.push({ depth, score, label: elementLabel(parent) });
      if (score > bestScore) {
        best = parent;
        bestScore = score;
      }

      current = parent;
    }

    if (state) {
      state.debugCandidates = candidates;
      state.debugShellScore = bestScore;
    }
    return best;
  }

  function canInsertAfter(anchor, state = null) {
    const parent = anchor?.parentNode;
    if (!(parent instanceof Element)) { if (state) state.debugInlineReject = 'anchor parent is not Element'; return false; }
    if (isUnsafeInlineParent(parent)) { if (state) state.debugInlineReject = `unsafe parent: ${elementLabel(parent)}`; return false; }

    const style = window.getComputedStyle(parent);
    if (style.display === 'inline' || style.display === 'inline-block' || style.display === 'contents') { if (state) state.debugInlineReject = `parent display=${style.display}`; return false; }

    // grid에 새 sibling을 직접 추가하면 CSS auto-placement가 다른 열/행에 배치할 수 있다.
    // 이 함수에서는 거부하고, 호출부가 영상 전용 grid cell 내부(inline-local) 또는 안전한 바깥 위치를 찾게 한다.
    if (style.display === 'grid' || style.display === 'inline-grid') { if (state) state.debugInlineReject = `parent display=${style.display}`; return false; }

    // 가로 flex에 sibling을 넣으면 영상 옆에 붙는 경우가 많다.
    // wrap이 허용되고 플레이어가 사실상 한 줄 전체를 차지하는 경우만 허용한다.
    if (style.display === 'flex' || style.display === 'inline-flex') {
      if (style.flexDirection.startsWith('column')) { if (state) state.debugInlineReject = ''; return true; }
      if (style.flexWrap === 'nowrap') { if (state) state.debugInlineReject = 'horizontal flex nowrap'; return false; }

      const parentRect = parent.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      // 가로 flex에서도 영상이 부모 폭의 85% 이상이면 사실상 한 줄 전체를 차지한다고 본다.
      // 85%는 우측의 작은 배지/버튼 정도는 허용하면서 2-column 레이아웃은 확실히 거르는 값이다.
      const ok = anchorRect.width >= parentRect.width * 0.85;
      if (state) state.debugInlineReject = ok ? '' : 'horizontal flex: anchor < 85% parent width';
      return ok;
    }

    if (state) state.debugInlineReject = '';
    return true;
  }

  function getContentLeft(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    return rect.left + borderLeft + paddingLeft;
  }

  function setInlineAlignment(widget, videoRect, parent) {
    const contentLeft = getContentLeft(parent);
    const offset = Math.max(0, Math.round(videoRect.left - contentLeft));
    widget.style.setProperty('margin-left', `${offset}px`, 'important');
  }

  function compensateAnchorBottomGap(widget, anchor) {
    if (!(anchor instanceof Element)) return;
    const style = window.getComputedStyle(anchor);
    const marginBottom = Math.max(0, Number.parseFloat(style.marginBottom) || 0);
    // 플레이어 래퍼 자체의 하단 margin 때문에 속도바가 영상에서 떨어지는 현상을 상쇄한다.
    // 속도바 아래 여백에는 원래 간격을 되돌려 다음 콘텐츠와의 간격은 유지한다.
    widget.style.setProperty('margin-top', `${-marginBottom}px`, 'important');
    widget.style.setProperty('margin-bottom', `${10 + marginBottom}px`, 'important');
  }

  function canInsertInsideShell(shell, videoEl) {
    if (!(shell instanceof Element) || shell === videoEl || isUnsafeInlineParent(shell)) return false;
    if (!shell.contains(videoEl)) return false;
    const style = window.getComputedStyle(shell);
    if (style.display === 'inline' || style.display === 'contents') return false;
    // 영상 전용 열/셀 내부라면 flex/grid의 바깥 자동배치를 건드리지 않고 안정적으로 아래에 둘 수 있다.
    return true;
  }

  function findSafeOuterPlacement(videoEl) {
    let node = videoEl.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const parent = node.parentElement;
      if (parent && !isUnsafeInlineParent(parent)) {
        const style = window.getComputedStyle(parent);
        if (!['inline', 'inline-block', 'contents', 'grid', 'inline-grid'].includes(style.display)) {
          if (!(style.display.includes('flex') && style.flexDirection.startsWith('row') && style.flexWrap === 'nowrap')) {
            return { anchor: node, parent };
          }
        }
      }
      node = parent;
    }
    return null;
  }

  function attachGeneralInlineController(videoEl, state) {
    const rect = getVisibleRect(videoEl, state);
    if (!rect) return false;

    const shell = findPlayerShell(videoEl, rect, state);
    state.debugShell = shell;
    const widget = ensureWidget(videoEl, state);
    widget.className = 'web-speed-controller-container web-speed-inline';
    setWidgetWidth(widget, rect.width);

    // 1) 가장 이상적인 경우: 플레이어 셸 바로 뒤에 sibling으로 삽입.
    if (canInsertAfter(shell, state)) {
      const parent = shell.parentNode;
      setInlineAlignment(widget, rect, parent);
      const expectedNext = shell.nextSibling;
      if (widget.parentNode !== parent || widget.previousSibling !== shell) {
        parent.insertBefore(widget, expectedNext);
      }
      compensateAnchorBottomGap(widget, shell);
      state.mode = 'inline';
      state.debugReason = `inline success; shell score=${Number(state.debugShellScore || 0).toFixed(1)}`;
      state.inlineAnchor = shell;
      state.hasController = true;
      trackedVideos.add(videoEl);
      scheduleDebugRefresh();
      return true;
    }

    const firstReject = state.debugInlineReject || 'unsafe layout';

    // 2) Flex/Grid의 '영상 칸' 안에 video가 들어 있다면, 바깥 flex/grid에 sibling을
    //    추가하지 말고 해당 칸 내부에서 video 뒤에 삽입한다. 스크롤 시 흔들리지 않는다.
    if (canInsertInsideShell(shell, videoEl)) {
      setInlineAlignment(widget, rect, shell);
      if (widget.parentNode !== shell || widget.previousSibling !== videoEl) {
        videoEl.insertAdjacentElement('afterend', widget);
      }
      compensateAnchorBottomGap(widget, videoEl);
      state.mode = 'inline-local';
      state.debugReason = `stable local inline; outer rejected: ${firstReject}`;
      state.inlineAnchor = videoEl;
      state.hasController = true;
      trackedVideos.add(videoEl);
      scheduleDebugRefresh();
      return true;
    }

    // 3) <a> 같은 위험 래퍼 안의 video는 그 래퍼 바깥의 안전한 문서 흐름에 배치.
    const outer = findSafeOuterPlacement(videoEl);
    if (outer) {
      setInlineAlignment(widget, rect, outer.parent);
      if (widget.parentNode !== outer.parent || widget.previousSibling !== outer.anchor) {
        outer.parent.insertBefore(widget, outer.anchor.nextSibling);
      }
      compensateAnchorBottomGap(widget, outer.anchor);
      state.mode = 'inline-outer';
      state.debugReason = `stable outer inline; inner rejected: ${firstReject}`;
      state.inlineAnchor = outer.anchor;
      state.hasController = true;
      trackedVideos.add(videoEl);
      scheduleDebugRefresh();
      return true;
    }

    state.debugReason = `inline rejected: ${firstReject}`;
    return false;
  }

  // ---------------------------------------------------------------------------
  // 임베디드 iframe: iframe 바깥에 DOM을 삽입할 수 없으므로 내부 안전 모드 사용
  // ---------------------------------------------------------------------------

  function attachEmbeddedFrameController(videoEl, state) {
    const rect = getVisibleRect(videoEl, state);
    if (!rect) return false;

    const widget = ensureWidget(videoEl, state);
    widget.className = 'web-speed-controller-container web-speed-embedded';
    widget.style.setProperty('margin-left', '0', 'important');

    const width = Math.min(rect.width, Math.max(120, window.innerWidth - 8));
    setWidgetWidth(widget, width);

    const host = document.body || document.documentElement;
    if (widget.parentNode !== host) host.appendChild(widget);

    const left = Math.min(Math.max(4, rect.left), Math.max(4, window.innerWidth - width - 4));
    widget.style.setProperty('position', 'fixed', 'important');
    widget.style.left = `${left}px`;
    // iframe 내부에서는 바깥쪽 '영상 아래'를 만들 수 없다. 자체 하단 컨트롤과 덜 겹치도록 상단에 둔다.
    widget.style.top = `${Math.max(4, rect.top + 6)}px`;
    widget.style.bottom = 'auto';

    state.mode = 'embedded';
    state.debugReason = isYouTube(videoEl) ? 'embedded iframe: YouTube' : 'embedded iframe: video reaches iframe bottom';
    state.inlineAnchor = null;
    state.hasController = true;
    trackedVideos.add(videoEl);
    scheduleDebugRefresh();
    return true;
  }

  // ---------------------------------------------------------------------------
  // 폴백 / 전체화면: 영상 위가 아니라 가능한 한 영상 바로 아래에 배치
  // ---------------------------------------------------------------------------

  function getFloatingHost(videoEl) {
    const fullscreenElement = document.fullscreenElement;
    if (fullscreenElement && fullscreenElement.contains(videoEl)) return fullscreenElement;
    return document.body || document.documentElement;
  }

  function updateFallbackLayout(videoEl, state) {
    const widget = state.widget;
    if (!widget || state.mode !== 'fallback' || state.inPictureInPicture) return;

    const rect = getVisibleRect(videoEl, state);
    const intersectsViewport = rect && rect.bottom > 0 && rect.top < window.innerHeight;
    if (!rect || !intersectsViewport) {
      widget.classList.remove('show-widget');
      return;
    }

    const host = getFloatingHost(videoEl);
    if (widget.parentNode !== host) host.appendChild(widget);

    const inFullscreen = host !== document.body && host !== document.documentElement;
    setWidgetWidth(widget, Math.min(rect.width, inFullscreen ? host.clientWidth : window.innerWidth - 8));

    if (inFullscreen) {
      // 전체화면에서는 영상 밖 공간이 없으므로 하단에 최소한으로 겹치는 예외 처리.
      const hostRect = host.getBoundingClientRect();
      widget.style.setProperty('position', 'absolute', 'important');
      widget.style.left = `${Math.max(4, rect.left - hostRect.left)}px`;
      widget.style.top = 'auto';
      widget.style.bottom = '8px';
    } else {
      const width = Math.min(rect.width, Math.max(120, window.innerWidth - 8));
      const left = Math.min(Math.max(4, rect.left), Math.max(4, window.innerWidth - width - 4));
      const top = rect.bottom + 2;

      widget.style.setProperty('position', 'fixed', 'important');
      widget.style.left = `${left}px`;
      widget.style.top = `${top}px`;
      widget.style.bottom = 'auto';
    }

    widget.classList.add('show-widget');
  }

  function attachFallbackController(videoEl, state) {
    const rect = getVisibleRect(videoEl, state);
    if (!rect) return false;

    const widget = ensureWidget(videoEl, state);
    widget.className = 'web-speed-controller-container web-speed-fallback show-widget';
    widget.style.setProperty('margin-left', '0', 'important');

    state.mode = 'fallback';
    if (!state.debugReason || state.debugReason.startsWith('inline success') || state.debugReason.startsWith('YouTube target')) state.debugReason = 'fallback: no safe inline placement';
    state.inlineAnchor = null;
    state.hasController = true;
    trackedVideos.add(videoEl);
    updateFallbackLayout(videoEl, state);
    return true;
  }

  // ---------------------------------------------------------------------------
  // video 상태 / 이벤트
  // ---------------------------------------------------------------------------

  function ensureVideoListeners(videoEl, state) {
    if (state.videoListenersAdded) return;
    state.videoListenersAdded = true;

    const retryAttach = () => attachControllerToVideo(videoEl);
    videoEl.addEventListener('loadedmetadata', retryAttach);
    videoEl.addEventListener('play', retryAttach);
    videoEl.addEventListener('playing', retryAttach);

    videoEl.addEventListener('pointerdown', () => {
      if (!isTouchLayout() && !isGifLikeVideo(videoEl, state)) return;
      state.userActivated = true;
      attachControllerToVideo(videoEl);
    }, { passive: true });

    videoEl.addEventListener('enterpictureinpicture', () => {
      state.inPictureInPicture = true;
      state.widget?.classList.remove('show-widget');
      if (state.widget) state.widget.style.display = 'none';
    });

    videoEl.addEventListener('leavepictureinpicture', () => {
      state.inPictureInPicture = false;
      if (state.widget) state.widget.style.display = '';
      attachControllerToVideo(videoEl);
    });
  }

  function ensureResizeObserver(videoEl, state) {
    if (!window.ResizeObserver || state.resizeObserver) return;

    state.resizeObserver = new ResizeObserver(() => {
      attachControllerToVideo(videoEl);
      if (state.mode === 'fallback') updateFallbackLayout(videoEl, state);
      if (state.mode?.startsWith('inline') && state.widget) {
        const rect = getVisibleRect(videoEl, state);
        if (rect) setWidgetWidth(state.widget, rect.width);
      }
    });

    state.resizeObserver.observe(videoEl);
  }

  function attachControllerToVideo(videoEl) {
    if (!(videoEl instanceof HTMLVideoElement)) return;

    let state = videoStateMap.get(videoEl);
    if (!state) {
      state = { debugId: ++debugSequence };
      videoStateMap.set(videoEl, state);
    }

    ensureVideoListeners(videoEl, state);
    ensureResizeObserver(videoEl, state);

    if (!videoEl.isConnected) return;

    const visible = Boolean(getVisibleRect(videoEl, state));
    if (!visible) {
      state.debugReason = isGifLikeVideo(videoEl, state) ? 'hidden: GIF-like autoplay+muted+loop' : 'hidden: below size/visibility threshold';
      if (state.widget) state.widget.style.display = 'none';
      scheduleDebugRefresh();
      return;
    }

    if (state.widget) state.widget.style.display = '';
    state.debugCandidates = [];
    state.debugInlineReject = '';

    // 전체화면에서는 문서 흐름의 '영상 아래'가 보이지 않으므로 별도 폴백 처리.
    if (document.fullscreenElement?.contains(videoEl)) {
      state.debugReason = 'fullscreen: document-flow below-video area unavailable';
      attachFallbackController(videoEl, state);
      return;
    }

    // 제3자 iframe은 iframe 바깥 아래에 삽입할 수 없다.
    // 영상이 iframe을 거의 꽉 채우면 아래에 넣어도 부모 페이지에서 잘리므로 내부 안전 모드로 처리한다.
    if (shouldUseEmbeddedFrameMode(videoEl)) {
      state.debugReason = isYouTube(videoEl) ? 'embedded iframe: YouTube' : 'embedded iframe: video reaches iframe bottom';
      attachEmbeddedFrameController(videoEl, state);
      return;
    }

    if (isYouTube(videoEl) && attachYouTubeController(videoEl, state)) return;
    if (attachGeneralInlineController(videoEl, state)) return;

    attachFallbackController(videoEl, state);
  }

  // ---------------------------------------------------------------------------
  // 동적 video / 레이아웃 변경 대응
  // ---------------------------------------------------------------------------

  function processNode(node) {
    if (!(node instanceof Element)) return;
    if (node.matches('video')) attachControllerToVideo(node);
    node.querySelectorAll?.('video').forEach(attachControllerToVideo);
  }

  function scanAndAttachVideos(root = document) {
    root.querySelectorAll('video').forEach(attachControllerToVideo);
  }

  function cleanupDetachedVideos() {
    for (const videoEl of trackedVideos) {
      if (videoEl.isConnected) continue;

      const state = videoStateMap.get(videoEl);
      state?.resizeObserver?.disconnect();
      state?.widget?.remove();
      trackedVideos.delete(videoEl);
    }
  }

  function scheduleAllLayouts() {
    if (layoutFramePending) return;
    layoutFramePending = true;

    window.requestAnimationFrame(() => {
      layoutFramePending = false;

      document.querySelectorAll('video').forEach(attachControllerToVideo);

      for (const videoEl of trackedVideos) {
        const state = videoStateMap.get(videoEl);
        if (!state?.widget) continue;

        if (state.mode === 'fallback') {
          updateFallbackLayout(videoEl, state);
        } else if (state.mode === 'embedded') {
          attachEmbeddedFrameController(videoEl, state);
        } else if (state.mode?.startsWith('inline')) {
          const rect = getVisibleRect(videoEl, state);
          if (rect) setWidgetWidth(state.widget, rect.width);
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 확장 popup용 디버그 API
  // ---------------------------------------------------------------------------

  function refreshControllersForDebug() {
    document.querySelectorAll('video').forEach(attachControllerToVideo);
    scheduleAllLayouts();
  }

  function getDebugSummary() {
    const videos = [...document.querySelectorAll('video')];
    const modes = {};
    for (const videoEl of videos) {
      const state = videoStateMap.get(videoEl);
      const gifLike = isGifLikeVideo(videoEl, state || {});
      const mode = state?.mode || (gifLike ? 'hidden' : '대기');
      modes[mode] = (modes[mode] || 0) + 1;
    }
    return {
      version: '1.3.0',
      frame: isEmbeddedFrame() ? 'iframe' : 'top',
      url: `${location.origin}${location.pathname}`,
      hostname: location.hostname || 'local',
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      videos: videos.length,
      modes
    };
  }

  function installDebugMessageListener() {
    const runtime = globalThis.browser?.runtime || globalThis.chrome?.runtime;
    if (!runtime?.onMessage?.addListener) return;

    runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== 'object') return undefined;

      // 팝업 진단은 최상위 문서만 응답한다. iframe의 컨트롤러 동작 자체는 그대로 유지한다.
      if (window !== window.top && (message.type === 'WVC_DEBUG_GET' || message.type === 'WVC_DEBUG_REFRESH')) {
        return undefined;
      }

      if (message.type === 'WVC_DEBUG_GET') {
        sendResponse({ ok: true, summary: getDebugSummary(), report: buildDebugReport() });
        return true;
      }

      if (message.type === 'WVC_DEBUG_REFRESH') {
        refreshControllersForDebug();
        window.setTimeout(() => {
          try { sendResponse({ ok: true, summary: getDebugSummary(), report: buildDebugReport() }); }
          catch (error) { sendResponse({ ok: false, error: String(error) }); }
        }, 60);
        return true;
      }

      return undefined;
    });
  }

  installDebugMessageListener();

  // ---------------------------------------------------------------------------
  // 초기화
  // ---------------------------------------------------------------------------

  // 디버그 UI는 페이지에 표시하지 않는다. 확장 아이콘의 popup에서만 조회한다.
  scanAndAttachVideos();

  window.addEventListener('scroll', scheduleAllLayouts, { passive: true, capture: true });
  window.addEventListener('resize', scheduleAllLayouts, { passive: true });
  window.addEventListener('orientationchange', scheduleAllLayouts, { passive: true });
  document.addEventListener('fullscreenchange', scheduleAllLayouts);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleAllLayouts, { passive: true });
    window.visualViewport.addEventListener('scroll', scheduleAllLayouts, { passive: true });
  }

  const observer = new MutationObserver((mutations) => {
    let sawAddedNodes = false;
    let sawRemovedNodes = false;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        // 우리가 넣은 컨트롤러 자체로 인한 observer 재진입은 무시한다.
        if (node instanceof Element && (node.classList?.contains('web-speed-controller-container') || node.closest?.('[data-wvc-internal="debug"]') || node.matches?.('[data-wvc-internal="debug"]'))) {
          continue;
        }
        sawAddedNodes = true;
        processNode(node);
      }

      if (mutation.removedNodes.length > 0) sawRemovedNodes = true;
    }

    // SPA에서 플레이어 셸/메타데이터가 교체되면 기존 video의 삽입 위치도 재검사한다.
    if (sawAddedNodes) {
      document.querySelectorAll('video').forEach(attachControllerToVideo);
    }

    scheduleDebugRefresh();

    if (sawRemovedNodes && !cleanupScheduled) {
      cleanupScheduled = true;
      window.requestAnimationFrame(() => {
        cleanupScheduled = false;
        cleanupDetachedVideos();
      });
    }
  });

  const observerRoot = document.body || document.documentElement;
  observer.observe(observerRoot, { childList: true, subtree: true });
})();
