/* global pdfjsLib */

// ====== Worker: dùng đúng version với pdf.min.js (legacy 3.4.120) ======
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "vendor/pdf.worker.min.js";

// ====== DOM ======
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

const btnPrev = document.getElementById("prev");
const btnNext = document.getElementById("next");
const pageNoEl = document.getElementById("pageNo");
const pageCountEl = document.getElementById("pageCount");

let jumpTimer = null;

function clamp(n, a, b) {
  return Math.min(Math.max(n, a), b);
}

function goToPage(n) {
  if (!pdfDoc) return;
  const target = clamp(n, 1, pdfDoc.numPages);
  if (target === pageNum) {
    if (pageNoEl) pageNoEl.value = String(pageNum);
    return;
  }
  pageNum = target;
  queueRender(pageNum);
}

function scheduleJumpFromInput() {
  if (!pageNoEl || !pdfDoc) return;
  const raw = pageNoEl.value;
  if (raw === "") return;

  // Debounce để tránh nhảy liên tục khi đang gõ (vd: gõ 12 sẽ đi qua 1 rồi 12)
  if (jumpTimer) clearTimeout(jumpTimer);
  jumpTimer = setTimeout(() => {
    const n = parseInt(pageNoEl.value, 10);
    if (!Number.isFinite(n)) return;
    goToPage(n);
  }, 250);
}

function immediateJumpFromInput() {
  if (jumpTimer) clearTimeout(jumpTimer);
  jumpTimer = null;
  if (!pageNoEl || !pdfDoc) return;

  const n = parseInt(pageNoEl.value, 10);
  if (!Number.isFinite(n)) {
    pageNoEl.value = String(pageNum);
    return;
  }
  goToPage(n);
}

// Nhảy trang khi người dùng gõ/chỉnh số
if (pageNoEl) {
  pageNoEl.addEventListener("input", scheduleJumpFromInput);  // gõ số: nhảy sau 250ms
  pageNoEl.addEventListener("change", immediateJumpFromInput); // bấm mũi tên ↑↓ / nhập xong: nhảy ngay
  pageNoEl.addEventListener("blur", immediateJumpFromInput);   // click ra ngoài: nhảy ngay
  pageNoEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      immediateJumpFromInput();
      pageNoEl.blur();
    }
  });
}
const zoomEl = document.getElementById("zoom");

// ====== Toolbar height sync (toolbar fixed không đè nội dung) ======
function syncBarHeight(){
  const bar = document.querySelector(".bar");
  if (!bar) return;
  document.documentElement.style.setProperty("--bar-h", bar.offsetHeight + "px");
}
window.addEventListener("load", syncBarHeight);
window.addEventListener("resize", syncBarHeight);
syncBarHeight();


// ====== PDF state ======
let pdfDoc = null;
let pageNum = 1;
let rendering = false;
let pendingPage = null;

// ====== Get PDF URL from ?file=... ======
function getPdfUrl() {
  // Yêu cầu chạy qua http(s) để PDF.js fetch được file PDF ổn định (mobile chặn file://)
  if (!/^https?:$/i.test(location.protocol)) {
    throw new Error("Unsupported protocol: " + location.protocol);
  }

  const p = new URLSearchParams(location.search);
  let f = p.get("file");

  // Ví dụ: index.html?file=pdf/bai1.pdf
  // Cho phép cả đường dẫn tương đối lẫn tuyệt đối (http/https)
  if (f) {
    try { f = decodeURIComponent(f); } catch (_) {}
  } else {
    f = "demo.pdf";
  }

  // Nếu là đường dẫn tương đối -> chuẩn hoá thành URL tuyệt đối theo location.href
  if (!/^https?:\/\//i.test(f)) {
    f = new URL(f, location.href).href;
  }

  return f;
}

// ====== Zoom modes ======
function computeScale(page, mode) {
  const base = page.getViewport({ scale: 1 });

  const bar = document.querySelector(".bar");
  const barH = bar ? bar.offsetHeight : 64;
  const gap = 10;          // khoảng cách giữa toolbar và nội dung
  const pad = 24;          // tương ứng padding-left/right 12px mỗi bên
  const padBottom = 24;    // padding-bottom 12px + buffer

  const viewW = window.innerWidth - pad;
  const viewH = window.innerHeight - barH - gap - padBottom;

  if (mode === "fit-width") return viewW / base.width;
  if (mode === "fit-height") return viewH / base.height;
  if (mode === "fit-page") return Math.min(viewW / base.width, viewH / base.height);

  // auto: ưu tiên vừa ngang, nhưng không vượt quá vừa trang
  const sW = viewW / base.width;
  const sPage = Math.min(viewW / base.width, viewH / base.height);
  return Math.min(sW, sPage);
}



// ====== Render logic ======
async function renderPage(num) {
  rendering = true;

  const page = await pdfDoc.getPage(num);

  const zoomMode = zoomEl?.value || "auto";
  const scale = computeScale(page, zoomMode);
  const viewport = page.getViewport({ scale });

  // ===== HiDPI / Retina fix: render theo devicePixelRatio để nét hơn =====
  const outputScale = window.devicePixelRatio || 1;

  // Kích thước hiển thị (CSS pixels)
  const cssW = Math.floor(viewport.width);
  const cssH = Math.floor(viewport.height);

  // Kích thước vẽ thực (device pixels)
  canvas.width = Math.floor(cssW * outputScale);
  canvas.height = Math.floor(cssH * outputScale);

  // Giữ đúng kích thước hiển thị, tránh bị CSS kéo giãn làm mờ
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";

  const transform =
    outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

  await page.render({ canvasContext: ctx, viewport, transform }).promise;

  window.__annoSync?.();

  if (pageNoEl) pageNoEl.value = String(pageNum);
  rendering = false;

  if (pendingPage !== null) {
    const n = pendingPage;
    pendingPage = null;
    renderPage(n);
  }
}

function queueRender(num) {
  if (rendering) pendingPage = num;
  else renderPage(num);
}

// ====== Controls ======
btnPrev?.addEventListener("click", () => {
  if (!pdfDoc || pageNum <= 1) return;
  pageNum--;
  queueRender(pageNum);
});

btnNext?.addEventListener("click", () => {
  if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
  pageNum++;
  queueRender(pageNum);
});

zoomEl?.addEventListener("change", () => {
  if (!pdfDoc) return;
  queueRender(pageNum);
});

// resize / rotate
window.addEventListener("resize", () => {
  if (!pdfDoc) return;
  queueRender(pageNum);
});

// ====== Init ======
async function init() {
  const url = getPdfUrl();

  pdfDoc = await pdfjsLib.getDocument(url).promise;
  pageCountEl.textContent = String(pdfDoc.numPages);

// Setup page jump input
if (pageNoEl) {
  pageNoEl.min = "1";
  pageNoEl.max = String(pdfDoc.numPages);
  pageNoEl.value = "1";
}

  pageNum = 1;
  queueRender(pageNum);
}


// ====== Expose state for annotation export (flatten to PDF) ======
window.__pdfn = window.__pdfn || {};
window.__pdfn.getPdfDoc = () => pdfDoc;
window.__pdfn.getPageNum = () => pageNum;
window.__pdfn.getNumPages = () => (pdfDoc ? pdfDoc.numPages : 0);
// Expose a safe getter for the current PDF URL (same logic as internal)
window.__pdfn.getPdfUrl = () => {
  // (same as getPdfUrl but callable from outside)
  if (!/^https?:$/i.test(location.protocol)) {
    throw new Error("Unsupported protocol: " + location.protocol);
  }
  const p = new URLSearchParams(location.search);
  let f = p.get("file");
  if (f) { try { f = decodeURIComponent(f); } catch (_) {} }
  else { f = "demo.pdf"; }
  if (!/^https?:\/\//i.test(f)) f = new URL(f, location.href).href;
  return f;
};

init().catch((err) => {
  console.error(err);
  alert("Không load được PDF.\n\n- Hãy đảm bảo bạn mở trang bằng http(s) (không phải file://).\n- Link phải dạng ?file=pdf/demo.pdf (đường dẫn tương đối) hoặc URL http(s).\n- Thử mở trực tiếp file PDF trong trình duyệt để kiểm tra 404.\n\nChi tiết lỗi: " + (err && err.message ? err.message : err))
  // không.");
});
