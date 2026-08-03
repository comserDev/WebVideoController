// 위젯 스타일 정의 (position: fixed 대신 position: relative 사용)
const WIDGET_STYLE = `
  .aagag-speed-controller-container {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background-color: #1e293b;
    color: #f8fafc;
    padding: 10px 16px;
    border-radius: 12px;
    margin-top: 10px;
    margin-bottom: 20px;
    font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    position: relative;
    z-index: 10;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    clear: both;
    float: none;
  }

  .aagag-speed-btn {
    background: #3b82f6;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s ease;
  }

  .aagag-speed-btn:hover {
    background: #2563eb;
  }

  .aagag-speed-slider-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }

  .aagag-speed-slider {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: #475569;
    accent-color: #10b981;
    cursor: pointer;
  }

  .aagag-speed-text {
    font-size: 13px;
    font-weight: 700;
    color: #10b981;
    min-width: 42px;
    text-align: right;
  }
`;

function injectStyles() {
  if (document.getElementById('aagag-controller-styles')) return;
  const styleEl = document.createElement('style');
  styleEl.id = 'aagag-controller-styles';
  styleEl.textContent = WIDGET_STYLE;
  document.head.appendChild(styleEl);
}

function attachControllerToVideo(videoEl) {
  // 이미 컨트롤러가 부착되어 있다면 중복 설치 방지
  if (videoEl.dataset.hasAagagController === 'true') return;
  videoEl.dataset.hasAagagController = 'true';

  // 컨트롤러 위젯 엘리먼트 생성
  const widget = document.createElement('div');
  widget.className = 'aagag-speed-controller-container';

  // 재생/일시정지 버튼
  const playBtn = document.createElement('button');
  playBtn.className = 'aagag-speed-btn';
  playBtn.textContent = videoEl.paused ? '▶ 재생' : '❚❚ 일시정지';

  playBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (videoEl.paused) {
      videoEl.play();
    } else {
      videoEl.pause();
    }
  });

  videoEl.addEventListener('play', () => { playBtn.textContent = '❚❚ 일시정지'; });
  videoEl.addEventListener('pause', () => { playBtn.textContent = '▶ 재생'; });

  // 배속 조절 슬라이더
  const sliderGroup = document.createElement('div');
  sliderGroup.className = 'aagag-speed-slider-group';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'aagag-speed-slider';
  slider.min = '0.1';
  slider.max = '3.0';
  slider.step = '0.1';
  slider.value = videoEl.playbackRate || '1.0';

  const speedText = document.createElement('span');
  speedText.className = 'aagag-speed-text';
  speedText.textContent = `${parseFloat(slider.value).toFixed(1)}x`;

  slider.addEventListener('input', (e) => {
    const newRate = parseFloat(e.target.value);
    videoEl.playbackRate = newRate;
    speedText.textContent = `${newRate.toFixed(1)}x`;
  });

  videoEl.addEventListener('ratechange', () => {
    slider.value = videoEl.playbackRate;
    speedText.textContent = `${videoEl.playbackRate.toFixed(1)}x`;
  });

  sliderGroup.appendChild(slider);
  sliderGroup.appendChild(speedText);

  widget.appendChild(playBtn);
  widget.appendChild(sliderGroup);

  // 비디오를 감싸는 래퍼(Wrapper) 요소가 있는 경우, 래퍼 뒤에 배치하여 비디오 영역과 겹치지 않고 공간을 확보함
  let targetEl = videoEl;
  const parent = videoEl.parentElement;
  if (parent && parent !== document.body) {
    const parentStyle = window.getComputedStyle(parent);
    if (
      parent.children.length === 1 || 
      parentStyle.position === 'relative' || 
      parentStyle.position === 'absolute' ||
      parentStyle.display === 'inline-block'
    ) {
      targetEl = parent;
    }
  }

  // 비디오 크기와 동일하게 위젯 너비 자동 동기화
  const updateWidgetWidth = () => {
    const videoWidth = videoEl.getBoundingClientRect().width || videoEl.offsetWidth;
    if (videoWidth > 0) {
      widget.style.width = `${videoWidth}px`;
    }
  };

  updateWidgetWidth();

  // 비디오 크기가 변경되거나 반응형으로 조절될 때 위젯 크기 자동 업데이트
  if (window.ResizeObserver) {
    const resizeObserver = new ResizeObserver(() => {
      updateWidgetWidth();
    });
    resizeObserver.observe(videoEl);
  } else {
    videoEl.addEventListener('loadedmetadata', updateWidgetWidth);
    window.addEventListener('resize', updateWidgetWidth);
  }

  if (targetEl.nextSibling) {
    targetEl.parentNode.insertBefore(widget, targetEl.nextSibling);
  } else {
    targetEl.parentNode.appendChild(widget);
  }
}

function scanAndAttachVideos() {
  injectStyles();
  const videos = document.querySelectorAll('video');
  videos.forEach(video => attachControllerToVideo(video));
}

// 초기 스캔 실행
scanAndAttachVideos();

// 동적으로 추가되는 비디오 대응을 위한 MutationObserver
const observer = new MutationObserver(() => {
  scanAndAttachVideos();
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});