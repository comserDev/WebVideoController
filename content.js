function createOrUpdateController(video) {
  let controls = video._aagagControls;

  // 1. 최초 1회 컨트롤러 UI 생성
  if (!controls) {
    controls = document.createElement("div");
    controls.className = "aagag-body-controls";

    // 재생/정지 버튼
    const playPauseBtn = document.createElement("button");
    playPauseBtn.className = "aagag-control-btn";
    playPauseBtn.textContent = video.paused ? "▶ 재생" : "❚❚ 정지";
    playPauseBtn.addEventListener("click", (e) => {
      e.stopPropagation(); e.preventDefault();
      video.paused ? video.play() : video.pause();
    });

    video.addEventListener("play", () => (playPauseBtn.textContent = "❚❚ 정지"));
    video.addEventListener("pause", () => (playPauseBtn.textContent = "▶ 재생"));

    // 속도 표시 라벨
    const speedLabel = document.createElement("span");
    speedLabel.className = "aagag-speed-label";
    speedLabel.textContent = `${(video.playbackRate || 1).toFixed(1)}x`;

    // 배속 슬라이더
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "aagag-speed-slider";
    slider.min = "0.1"; slider.max = "4.0"; slider.step = "0.1";
    slider.value = video.playbackRate || 1;

    slider.addEventListener("input", (e) => {
      e.stopPropagation();
      const rate = parseFloat(e.target.value);
      video.playbackRate = rate;
      speedLabel.textContent = `${rate.toFixed(1)}x`;
    });

    // 이벤트 전파 차단 (AAGAG 사이트 클릭 방지)
    ['click', 'mousedown', 'mouseup', 'touchstart', 'contextmenu'].forEach(eventType => {
      controls.addEventListener(eventType, (e) => e.stopPropagation());
    });

    controls.appendChild(playPauseBtn);
    controls.appendChild(slider);
    controls.appendChild(speedLabel);

    document.body.appendChild(controls);
    video._aagagControls = controls;
  }

  // 2. 비디오 외부 하단 위치 계산
  updateControllerPosition(video, controls);
}

function updateControllerPosition(video, controls) {
  const rect = video.getBoundingClientRect();

  // 비디오가 화면에 전혀 보이지 않거나 크기가 0이면 숨김
  if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
    controls.style.display = "none";
    return;
  }

  controls.style.display = "flex";
  // 비디오 바로 바깥 아래쪽(rect.bottom + 6px)에 위치 고정
  controls.style.top = `${rect.bottom + 6}px`;
  controls.style.left = `${rect.left}px`;
}

function updateAllControllers() {
  document.querySelectorAll("video").forEach(createOrUpdateController);
}

// 스크롤 및 창 크기 변경 시 비디오를 따라 이동
window.addEventListener("scroll", updateAllControllers, { passive: true });
window.addEventListener("resize", updateAllControllers, { passive: true });

// 동적 로딩 대응 및 주기적 위치 동기화
const observer = new MutationObserver(updateAllControllers);
observer.observe(document.body, { childList: true, subtree: true });
setInterval(updateAllControllers, 300);

updateAllControllers();