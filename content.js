/**
 * ==============================================================================
 * 웹(AAGAG) 비디오 컨트롤러 - content.js
 * 
 * [핵심 구조 및 기능 요약]
 * 1. 상태 관리: WeakMap 써서 DOM 메모리 누수 막고 GC(가비지 컬렉터) 최적화함
 * 2. UI 렌더링: 사이트마다 레이아웃 꼬이는 거 빡쳐서 그냥 공중에 띄움 (오버레이 방식)
 * 3. 이벤트 최적화: 마우스 추적에 rAF, DOM 스캔에 디바운싱 먹여서 쓸데없는 렉 줄임
 * 4. 반응형 동기화: ResizeObserver로 비디오 크기/위치 실시간으로 따라가게 만듦
 * ==============================================================================
 */

// 비디오 요소랑 위젯 상태 묶어두는 저장소. 
// DOM에서 비디오 날아가면 같이 사라지게 WeakMap으로 만듦 (메모리 릭 방지용)
const videoStateMap = new WeakMap();

// 위젯에 먹일 CSS 스타일.
// 기본 플레이어 바(진행바, 자막 등) 안 가리게 무조건 좌상단에 박아둠.
// 평소엔 시야 안 가리게 투명도(opacity) 0으로 숨겨놓음.
const WIDGET_STYLE = `
  .web-speed-controller-container {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background-color: rgba(30, 41, 59, 0.85);
    backdrop-filter: blur(4px);
    color: #f8fafc;
    padding: 10px 16px;
    border-radius: 12px;
    font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    
    /* 비디오 위에 띄워야 하니까 absolute 주고 z-index 왕창 올림 */
    position: absolute !important;
    z-index: 2147483647 !important;
    box-sizing: border-box;
    
    /* 평소엔 숨김 (마우스 호버할 때만 보여줌) */
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.3s ease, visibility 0.3s ease;
  }

  /* 활성화되면 짠 하고 나타나게 하는 클래스 */
  .web-speed-controller-container.show-widget {
    opacity: 1 !important;
    visibility: visible !important;
  }

  /* 버튼 디자인 */
  .web-speed-btn {
    background: #3b82f6;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s ease;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .web-speed-btn:hover { background: #2563eb; }

  /* 배속 슬라이더 영역 */
  .web-speed-slider-group {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }
  
  .web-speed-slider {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: #475569;
    accent-color: #10b981;
    cursor: pointer;
  }

  /* 배속 텍스트(예: 1.5x) */
  .web-speed-text {
    font-size: 13px;
    font-weight: 700;
    color: #10b981;
    min-width: 42px;
    text-align: right;
    flex-shrink: 0;
  }
`;

// 전역 스타일 <head>에 쑤셔넣는 함수. 중복 주입 안 되게 id로 방어해둠.
function injectStyles() {
  if (document.getElementById('web-controller-styles')) return;
  const styleEl = document.createElement('style');
  styleEl.id = 'web-controller-styles';
  styleEl.textContent = WIDGET_STYLE;
  (document.head || document.documentElement).appendChild(styleEl);
}

// 비디오에 붙일 컨트롤러 UI(DOM) 만들고 이벤트 달아주는 곳
function createWidgetUI(videoEl) {
  const widget = document.createElement('div');
  widget.className = 'web-speed-controller-container';

  // [1] 재생/일시정지 버튼 셋업
  const playBtn = document.createElement('button');
  playBtn.className = 'web-speed-btn';
  playBtn.textContent = videoEl.paused ? '▶ 재생' : '❚❚ 일시정지';

  // 비디오 상태 바뀌면 버튼 텍스트도 알아서 바뀌게 연동
  videoEl.addEventListener('play', () => { playBtn.textContent = '❚❚ 일시정지'; });
  videoEl.addEventListener('pause', () => { playBtn.textContent = '▶ 재생'; });

  // 클릭하면 재생/정지 토글
  playBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (videoEl.paused) videoEl.play();
    else videoEl.pause();
  });

  // [2] 배속 조절 슬라이더 셋업
  const sliderGroup = document.createElement('div');
  sliderGroup.className = 'web-speed-slider-group';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'web-speed-slider';
  slider.min = '0.1';
  slider.max = '3.0';
  slider.step = '0.1';
  slider.value = videoEl.playbackRate || '1.0';

  const speedText = document.createElement('span');
  speedText.className = 'web-speed-text';
  speedText.textContent = `${parseFloat(slider.value).toFixed(1)}x`;

  // 슬라이더 땡기면 바로 비디오 배속에 꽂아버림
  slider.addEventListener('input', (e) => {
    const newRate = parseFloat(e.target.value);
    videoEl.playbackRate = newRate;
    speedText.textContent = `${newRate.toFixed(1)}x`;
  });

  // 다른 스크립트가 배속 건드려도 슬라이더 위치가 따라가게 동기화
  videoEl.addEventListener('ratechange', () => {
    slider.value = videoEl.playbackRate;
    speedText.textContent = `${videoEl.playbackRate.toFixed(1)}x`;
  });

  // 조립 끝난 요소들 합치기
  sliderGroup.appendChild(slider);
  sliderGroup.appendChild(speedText);
  widget.appendChild(playBtn);
  widget.appendChild(sliderGroup);

  return widget;
}

// 비디오 태그 찾아서 그 위에 컨트롤러 띄워주는 핵심 로직
function attachControllerToVideo(videoEl) {
  // WeakMap에서 현재 비디오 상태 가져옴 (없으면 빈 객체 할당)
  let state = videoStateMap.get(videoEl) || {};

  // 비디오가 늦게 뜨는 경우 대비해서 주요 이벤트 터질 때 다시 부착 시도하게 걸어둠
  if (!state.listenersAdded) {
    state.listenersAdded = true;
    const retryAttach = () => attachControllerToVideo(videoEl);
    videoEl.addEventListener('loadedmetadata', retryAttach);
    videoEl.addEventListener('play', retryAttach);
    videoEl.addEventListener('playing', retryAttach);
    videoStateMap.set(videoEl, state);
  }

  const rect = videoEl.getBoundingClientRect();
  
  // 숨겨져 있거나(크기 0) 너무 작은 썸네일(150px 미만)이면 일단 패스함
  if (rect.width < 150 || rect.height === 0) {
    if (window.ResizeObserver && !state.waitObserver) {
      state.waitObserver = new ResizeObserver(() => {
        const currentRect = videoEl.getBoundingClientRect();
        // 비디오 크기 정상화되는 순간 잽싸게 부착 다시 시도
        if (currentRect.width >= 150 && currentRect.height > 0) {
          attachControllerToVideo(videoEl);
        }
      });
      state.waitObserver.observe(videoEl);
      videoStateMap.set(videoEl, state);
    }
    return; // 지금은 안 보이니까 여기서 종료
  }

  // 크기 정상화됐으면 뻘짓 안 하게 대기 타던 옵저버 날려버림
  if (state.waitObserver) {
    state.waitObserver.disconnect();
    state.waitObserver = null;
    videoStateMap.set(videoEl, state);
  }

  // [예외 케이스] 유튜브는 오버레이로 띄우면 UI 다 꼬여서, 그냥 제목 밑에 얌전히 인라인으로 끼워넣음
  if (window.location.hostname.includes('youtube.com')) {
    const ytTarget = document.querySelector('#below #above-the-fold, #below ytd-watch-metadata, #below #title, #below, ytd-watch-metadata');
    
    if (ytTarget && ytTarget.parentNode) {
      if (state.widget && ytTarget.parentNode.contains(state.widget)) return; // 중복 부착 방지
      
      let widget = state.widget || createWidgetUI(videoEl);
      state.widget = widget;
      
      // 공중에 띄우는 CSS 다 무력화시키고 블록으로 만듦
      widget.style.setProperty('position', 'relative', 'important');
      widget.style.setProperty('top', 'auto', 'important');
      widget.style.setProperty('left', 'auto', 'important');
      widget.style.setProperty('opacity', '1', 'important');
      widget.style.setProperty('visibility', 'visible', 'important');
      widget.style.setProperty('width', '100%', 'important');
      widget.style.setProperty('margin-bottom', '12px', 'important');

      ytTarget.parentNode.insertBefore(widget, ytTarget);
      state.hasController = true;
      videoStateMap.set(videoEl, state);
      return;
    } else {
      return;
    }
  }

  // [기본 케이스] 범용 사이트 (AAGAG, MBC 등). 비디오 부모 요소 찾아서 공중에 띄우는(Floating) 방식
  let targetContainer = videoEl.parentElement;
  
  if (targetContainer) {
    // 자식 위젯이 absolute로 뜰 거니까 부모는 무조건 relative로 잡아줌
    const computedStyle = window.getComputedStyle(targetContainer);
    if (computedStyle.position === 'static') {
      targetContainer.style.position = 'relative';
    }

    if (state.hasController && state.widget && targetContainer.contains(state.widget)) {
      return;
    }

    let widget = state.widget;
    if (!widget) {
      widget = createWidgetUI(videoEl);
      state.widget = widget;
    }

    targetContainer.appendChild(widget);
    state.hasController = true;

    // 비디오 크기나 위치 바뀌면 위젯도 똑같이 따라가게 맞춤 (1:1 동기화)
    const updateWidgetLayout = () => {
      if (!widget.parentNode) return;
      const vRect = videoEl.getBoundingClientRect();
      const pRect = targetContainer.getBoundingClientRect();

      if (vRect.width > 0) {
        // 양옆 여백(16px*2=32px) 빼서 너비 맞춤
        widget.style.width = `${Math.max(280, vRect.width - 32)}px`;
        
        // 부모랑 비디오 사이의 오프셋 갭 계산해서 좌상단에 정확히 얹어줌
        const leftOffset = Math.max(0, vRect.left - pRect.left);
        const topOffset = Math.max(0, vRect.top - pRect.top);
        
        widget.style.left = `${leftOffset + 16}px`;
        widget.style.top = `${topOffset + 16}px`;
      }
    };

    updateWidgetLayout();

    // 화면 창 크기 조절하거나 전체화면 할 때마다 레이아웃 다시 계산함
    if (window.ResizeObserver && !state.resizeObserver) {
      const resizeObserver = new ResizeObserver(() => updateWidgetLayout());
      resizeObserver.observe(videoEl);
      resizeObserver.observe(targetContainer);
      state.resizeObserver = resizeObserver;
    }

    // 마우스가 비디오 위에 있는지 좌표로 계산해서 위젯 보여줌. 
    // 투명 막이나 엉뚱한 iframe 덮여있는 사이트들 DOM 이벤트 씹히는 거 빡쳐서 
    // 그냥 모니터 절대 좌표(e.clientX/Y)로 교차 영역 무식하게 계산함. (이게 젤 확실해)
    if (!state.mouseTrackerAdded) {
      state.mouseTrackerAdded = true;
      let ticking = false;
      
      window.addEventListener('mousemove', (e) => {
        if (!state.widget) return;
        
        // requestAnimationFrame 써서 프레임 단위로 처리함 (마우스 움직일 때마다 렉 걸리는 거 방지)
        if (!ticking) {
          window.requestAnimationFrame(() => {
            const vRect = videoEl.getBoundingClientRect();
            
            if (vRect.width > 0 && vRect.height > 0) {
              const isMouseOverVideo = (
                e.clientX >= vRect.left && e.clientX <= vRect.right &&
                e.clientY >= vRect.top && e.clientY <= vRect.bottom
              );
              
              if (isMouseOverVideo) {
                state.widget.classList.add('show-widget');
              } else {
                state.widget.classList.remove('show-widget');
              }
            }
            ticking = false;
          });
          ticking = true;
        }
      });
    }
    
    // 세팅 다 끝난 상태 WeakMap에 저장
    videoStateMap.set(videoEl, state);
  }
}

// 문서 싹 뒤져서 비디오 태그 찾고 컨트롤러 다 붙여버림
function scanAndAttachVideos() {
  injectStyles();
  const videos = document.querySelectorAll('video');
  videos.forEach(video => attachControllerToVideo(video));
}

// 스크립트 첨 로드될 때 일단 한 번 긁어줌
scanAndAttachVideos();

// 무한 스크롤이나 댓글 달릴 때 DOM 바뀌는 거 감지함.
// 조금만 바뀌어도 냅다 스캔 돌리면 브라우저 뻗으니까, 
// 디바운싱(300ms) 먹여서 변화 다 끝나고 조용해지면 딱 한 번만 스캔하게 만듦.
let debounceTimer;
const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    scanAndAttachVideos();
  }, 300);
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});