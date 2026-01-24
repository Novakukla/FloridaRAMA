/* global NOVA_PROJECTS */

(function () {
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  // Footer year
  const yearEl = document.querySelector("[data-year]");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Projects grid
  const grid = document.querySelector("[data-projects-grid]");
  if (grid && Array.isArray(window.NOVA_PROJECTS)) {
    const frag = document.createDocumentFragment();

    window.NOVA_PROJECTS.forEach((p) => {
      const a = document.createElement("a");
      a.className = "projectCard";
      a.href = `#`;
      a.setAttribute("aria-label", `Open project: Lorem ipsum`);

      a.innerHTML = `
        <div class="thumb" aria-hidden="true"></div>
        <div class="cardBody">
          <div class="cardTitle">
            <h3>Lorem ipsum</h3>
          </div>
          <p>Lorem ipsum dolor sit amet.</p>
        </div>
      `;

      frag.appendChild(a);
    });

    grid.appendChild(frag);
  }

  // Scroll reveal
  const revealTargets = [
    ...document.querySelectorAll(".projectCard"),
    ...document.querySelectorAll(".reveal"),
  ];

  if (revealTargets.length) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add("inView");
          io.unobserve(e.target);
        });
      },
      { rootMargin: "-10% 0px -10% 0px", threshold: 0.06 },
    );

    revealTargets.forEach((el) => io.observe(el));
  }

  // Firewatch-style scene parallax (scroll + pointer)
  const keyart = document.querySelector("[data-keyart]");
  const layers = keyart
    ? [...keyart.querySelectorAll(".sceneLayer[data-speed]")]
    : [];
  const heroTitle = document.querySelector("[data-hero-title]");

  let pointerX = 0;
  let pointerY = 0;

  const setPointer = (x, y) => {
    pointerX = x;
    pointerY = y;
  };

  if (keyart && !prefersReducedMotion) {
    const onPointer = (e) => {
      const rect = keyart.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const nx = clamp((e.clientX - cx) / (rect.width / 2), -1, 1);
      const ny = clamp((e.clientY - cy) / (rect.height / 2), -1, 1);
      setPointer(nx, ny);
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
  }

  const parallaxSections = [...document.querySelectorAll("[data-parallax]")];

  const parallaxTick = () => {
    if (prefersReducedMotion) return;

    // Scene: Firewatch-like translate based on scrollTop and data-speed
    if (keyart && layers.length) {
      const scrollTop = window.scrollY || 0;

      layers.forEach((layer) => {
        const speed = clamp(Number(layer.dataset.speed || 10), 0, 120);
        const follow = clamp(Number(layer.dataset.follow || 0), -1, 1);

        // Base Firewatch-style parallax: layers drift upward as you scroll down.
        // Optional follow (>0): add downward drift so it feels like it's under your finger.
        const y = -scrollTop * (speed / 100) + scrollTop * follow;
        const mx = pointerX * (speed / 100) * 14;
        const my = pointerY * (speed / 100) * 8;
        layer.style.transform = `translate3d(${mx}px, ${y + my}px, 0)`;
      });

      // Title starts near top and scrolls downward a bit
      if (heroTitle) {
        // Drift down with the scroll, then get covered by the trees divider.
        const down = clamp(scrollTop * 0.05, 0, 900);
        heroTitle.style.transform = `translate3d(0, ${down}px, 0)`;
        // Keep fade subtle; the divider should do most of the "disappearing".
        heroTitle.style.opacity = String(1 - clamp(scrollTop / 5000, 0, 0.18));
      }
    }

    // Generic space background parallax (used on other pages)
    const y = window.scrollY;
    parallaxSections.forEach((sec) => {
      const bg = sec.querySelector(".spaceBg");
      if (!bg) return;

      const rect = sec.getBoundingClientRect();
      const viewH = window.innerHeight || 800;
      const center = rect.top + rect.height / 2;
      const t = (center - viewH / 2) / viewH;

      const translate = clamp(t * 18, -26, 26);
      bg.style.transform = `translate3d(0, ${translate}px, 0) scale(1.06)`;
      bg.style.opacity = String(0.82 + clamp(1 - Math.abs(t), 0, 1) * 0.12);
      bg.style.filter = `saturate(125%) hue-rotate(${clamp(y * 0.006, 0, 12)}deg)`;
    });

    // Scrollytelling: step-based reveals for hero content
    try {
      const hero = document.querySelector('.hero');
      if (hero) {
        const vh = window.innerHeight || 800;
        // progress 0..1 based on page scroll so elements reveal as user scrolls down
        // use a scale so small scroll gestures advance the scrollytelling
        const raw = clamp((window.scrollY || 0) / (vh * 0.5), 0, 1);

        // steps: 1=logo (always active on load), 2=tagline, 3=crab, 4=buttons
        const thresholds = [0.0, 0.12, 0.33, 0.6];

        const stepEls = {
          1: document.querySelectorAll('[data-step="1"]'),
          2: document.querySelectorAll('[data-step="2"]'),
          3: document.querySelectorAll('[data-step="3"]'),
          4: document.querySelectorAll('[data-step="4"]'),
        };

        Object.keys(stepEls).forEach((k) => {
          const idx = Number(k) - 1;
          const active = raw >= thresholds[idx];
          stepEls[k].forEach((el, i) => {
            if (active) {
              // stagger buttons in step 4
              if (Number(k) === 4) el.style.transitionDelay = `${i * 80}ms`;
              el.classList.add('active');
            } else {
              el.classList.remove('active');
              el.style.transitionDelay = '';
            }
          });
        });

        // no additional settling behavior; let hero elements reveal naturally
      }
    } catch (e) {
      // fail silently
    }

    // No video fade behavior here; video is a normal element that fills the
    // initial viewport. The next section will scroll normally with its own
    // black background.

    // Force hero elements to remain anchored at all times to avoid layout jumps.
    try {
      const heroInner = document.querySelector('.hero-inner');
      if (heroInner) heroInner.classList.add('anchored');
    } catch (e) {
      // ignore
    }
  };

  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      parallaxTick();
    });
  };

  parallaxTick();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", parallaxTick);

  // Resume modal
  const modal = document.querySelector("[data-modal]");
  const openBtns = document.querySelectorAll("[data-open-resume]");
  const closeBtns = document.querySelectorAll("[data-close-modal]");

  if (modal && openBtns.length) {
    let lastActive = null;

    const open = () => {
      lastActive = document.activeElement;
      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";

      // Focus close button
      const close = modal.querySelector("[data-close-modal]");
      if (close) close.focus();
    };

    const close = () => {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      if (lastActive && lastActive.focus) lastActive.focus();
    };

    openBtns.forEach((b) => b.addEventListener("click", open));
    closeBtns.forEach((b) => b.addEventListener("click", close));

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("open")) close();
    });

    // Trap focus lightly
    modal.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const focusables = modal.querySelectorAll(
        "a, button, input, textarea, select, [tabindex]:not([tabindex='-1'])",
      );
      const list = [...focusables].filter((x) => !x.hasAttribute("disabled"));
      if (!list.length) return;

      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
