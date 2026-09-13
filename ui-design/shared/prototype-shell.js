/* global document, window */

(function () {
  const roleCopy = {
    student: { name: 'Somchai', email: 'student@example.com', initials: 'S' },
    tutor: { name: 'Pim', email: 'pim@example.com', initials: 'P' },
  };

  const icons = {
    dashboard:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>',
    profile:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20c.7-3.1 3.1-4.8 6.5-4.8s5.8 1.7 6.5 4.8"/></svg>',
    bookings:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 13.5h6M9 17h3"/></svg>',
    listings:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v17H7.5A2.5 2.5 0 0 1 5 17.5z"/><path d="M8 3v17M11.5 7h4.5M11.5 10.5h4.5"/></svg>',
    availability:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 9.5h16M8 13h3M8 16.5h3M14 13h2"/></svg>',
    settings:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.1 1.9 2.2.5 1.8-1 1.5 1.5-1 1.8.5 2.2L20 11v2l-1.9 1.1-.5 2.2 1 1.8-1.5 1.5-1.8-1-2.2.5L12 21l-1.1-1.9-2.2-.5-1.8 1-1.5-1.5 1-1.8-.5-2.2L4 13v-2l1.9-1.1.5-2.2-1-1.8L6.9 4.4l1.8 1 2.2-.5z"/><circle cx="12" cy="12" r="2.7"/></svg>',
    support:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><path d="M4 13h3v5H5.5A1.5 1.5 0 0 1 4 16.5zM20 13h-3v5h1.5a1.5 1.5 0 0 0 1.5-1.5zM17 18c0 1.1-.9 2-2 2h-2"/></svg>',
    privacy:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 19 6v5.3c0 4.5-2.7 7.6-7 9.2-4.3-1.6-7-4.7-7-9.2V6z"/><rect x="9.2" y="10.5" width="5.6" height="5" rx="1"/><path d="M10.5 10.5V9.3a1.5 1.5 0 0 1 3 0v1.2"/></svg>',
    signout:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h4.5A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5H14M10 8l-4 4 4 4M6 12h9"/></svg>',
  };

  const navigation = {
    student: [
      ['dashboard', 'Dashboard', 'แดชบอร์ด', 'dashboard-student.html'],
      ['profile', 'My profile', 'โปรไฟล์ของฉัน', 'student-profile.html'],
      ['bookings', 'My bookings', 'การจองของฉัน', 'booking.html#bookings', '0'],
      ['settings', 'Settings', 'การตั้งค่า', '#settings'],
      ['support', 'Support', 'ฝ่ายช่วยเหลือ', '#support'],
      ['privacy', 'Privacy', 'ความเป็นส่วนตัว', '#privacy'],
      ['signout', 'Sign out', 'ออกจากระบบ', '#signout'],
    ],
    tutor: [
      ['dashboard', 'Dashboard', 'แดชบอร์ด', 'dashboard-tutor.html'],
      ['profile', 'My profile', 'โปรไฟล์ของฉัน', 'tutor-profile.html'],
      ['listings', 'My listings', 'คอร์สของฉัน', 'listing-form.html'],
      ['availability', 'Availability', 'ตารางว่าง', 'availability.html'],
      ['settings', 'Settings', 'การตั้งค่า', '#settings'],
      ['support', 'Support', 'ฝ่ายช่วยเหลือ', '#support'],
      ['privacy', 'Privacy', 'ความเป็นส่วนตัว', '#privacy'],
      ['signout', 'Sign out', 'ออกจากระบบ', '#signout'],
    ],
  };

  function copy(en, th, tag = 'span') {
    return `<${tag} data-en="${en}" data-th="${th}">${en}</${tag}>`;
  }

  function navMarkup(role, active) {
    return navigation[role]
      .map(([id, en, th, href, count]) => {
        const activeAttributes = id === active ? ' class="is-active" aria-current="page"' : '';
        const icon = `<span class="ico" aria-hidden="true">${icons[id]}</span>`;
        const label = `<span class="dash-nav-label" data-en="${en}" data-th="${th}">${en}</span>`;
        const left = `<span class="flex items-center gap-2.5">${icon}${label}</span>`;

        if (id === 'privacy' || id === 'signout') {
          const danger = id === 'signout' ? ' class="danger"' : '';
          return `<button type="button"${danger} title="${en}">${left}</button>`;
        }

        const badge = count
          ? `<span class="dash-nav-badge rounded-full px-2 py-0.5 text-xs font-bold" style="background:${role === 'student' ? 'rgba(34,196,154,.14)' : 'rgba(14,142,234,.14)'};color:${role === 'student' ? '#0e8a73' : '#0b6db0'}">${count}</span>`
          : '';
        return `<a href="${href}"${activeAttributes} title="${en}">${left}${badge}</a>`;
      })
      .join('');
  }

  function headerMarkup(config) {
    const secondary = config.headerSecondary
      ? `<a href="${config.headerSecondary.href}">${copy(config.headerSecondary.en, config.headerSecondary.th)}</a>`
      : '';
    const primary = config.headerPrimary
      ? `<a class="dash-cta" href="${config.headerPrimary.href}">${copy(config.headerPrimary.en, config.headerPrimary.th)}</a>`
      : '';
    const color = config.role === 'student' ? '#22c49a' : '#0e8eea';

    return `<header class="dash-header"><nav aria-label="Dashboard Top Navigation"><button class="dash-lang-btn" type="button" aria-label="Switch language to Thai" aria-pressed="false"><span class="dot" style="background-color:${color}"></span><span class="dash-lang-label">EN</span></button>${secondary}${primary}</nav></header>`;
  }

  function mount(config) {
    const role = config.role === 'student' ? 'student' : 'tutor';
    const user = roleCopy[role];
    const template = document.getElementById('page-content');
    const pageContent = template ? template.innerHTML : '';
    const appRoot = document.getElementById('app');

    document.body.dataset.role = role;
    appRoot.innerHTML = `
      <div class="dash-root">
        <div class="dash-art" aria-hidden="true"><div class="blob dash-b1"></div><div class="blob dash-b2"></div><div class="blob dash-b3-${role}"></div></div>
        <div class="dash-app" id="dashboardApp">
          <button class="dash-sidebar-backdrop" type="button" aria-label="Close sidebar"></button>
          <aside class="dash-sidebar" id="dashboard-sidebar" aria-label="Dashboard">
            <div class="dash-sb-head">
              <a class="dash-logo" href="${role === 'student' ? 'dashboard-student.html' : 'dashboard-tutor.html'}" aria-label="Dashboard" title="Dashboard"><span class="mono">HK</span><span class="dash-logo-word">HKTutor</span></a>
              <button class="dash-rail-toggle" type="button" aria-label="Open sidebar" title="Open sidebar"><span class="mono">HK</span><span class="burger" aria-hidden="true"><i></i><i></i><i></i></span></button>
              <button class="dash-sb-close" type="button" aria-label="Close sidebar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m14.5 5-7 7 7 7"/></svg></button>
            </div>
            <div class="dash-card dash-side-card dash-account-card dash-profile-nav-card">
              <div class="dash-user-chip" style="margin-bottom:1rem"><div class="dash-avatar dash-avatar-${role}" aria-hidden="true">${user.initials}</div><div class="min-w-0"><b class="block truncate text-sm font-extrabold text-[#1a1916]">${user.name}</b><span class="block truncate text-xs text-[#5e5a52]">${user.email}</span></div></div>
              <nav class="dash-side-nav dash-side-nav-${role}" aria-label="Sidebar Navigation">${navMarkup(role, config.active)}</nav>
            </div>
            <div class="dash-card dash-side-card"><h2>${copy('Need help?', 'ต้องการความช่วยเหลือ?')}</h2><p>${copy('Read how HKTutor handles your data, or reach support anytime.', 'อ่านรายละเอียดการจัดการข้อมูลส่วนบุคคล หรือติดต่อทีมสนับสนุนได้ตลอดเวลา')}</p><button class="dash-link" type="button">${copy('Privacy notice', 'ประกาศความเป็นส่วนตัว')}</button></div>
          </aside>
          <div class="dash-main-wrap">
            ${headerMarkup(config)}
            <main class="dash-main">${pageContent}</main>
            <footer class="dash-footer"><span>© 2026 HKTutor. All rights reserved.</span><span class="sep">|</span><button type="button" style="color:inherit">${copy('Privacy & support', 'ความเป็นส่วนตัวและช่วยเหลือ')}</button></footer>
          </div>
        </div>
        <div class="proto-toast" role="status" aria-live="polite"></div>
      </div>`;

    const dashboardApp = document.getElementById('dashboardApp');
    const media = window.matchMedia('(max-width: 960px)');
    const backdrop = appRoot.querySelector('.dash-sidebar-backdrop');

    function syncOverflow() {
      document.body.style.overflow =
        media.matches && !dashboardApp.classList.contains('sb-collapsed') ? 'hidden' : '';
    }

    function setCollapsed(collapsed, persist = true) {
      dashboardApp.classList.toggle('sb-collapsed', collapsed);
      backdrop.tabIndex = media.matches && !collapsed ? 0 : -1;
      if (persist) {
        window.localStorage.setItem('hktutor-sidebar-collapsed', String(collapsed));
      }
      syncOverflow();
    }

    function syncSidebar() {
      const saved = window.localStorage.getItem('hktutor-sidebar-collapsed');
      setCollapsed(media.matches ? true : saved === 'true', false);
    }

    appRoot.querySelector('.dash-sb-close').addEventListener('click', () => {
      setCollapsed(!dashboardApp.classList.contains('sb-collapsed'));
    });
    appRoot.querySelector('.dash-rail-toggle').addEventListener('click', () => {
      setCollapsed(!dashboardApp.classList.contains('sb-collapsed'));
    });
    backdrop.addEventListener('click', () => {
      setCollapsed(true);
    });
    appRoot.querySelector('.dash-lang-btn').addEventListener('click', toggleLanguage);
    media.addEventListener('change', syncSidebar);
    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape' &&
        media.matches &&
        !dashboardApp.classList.contains('sb-collapsed')
      ) {
        setCollapsed(true);
      }
    });

    const savedLanguage = localStorage.getItem('hktutor-prototype-language');
    document.documentElement.lang = savedLanguage === 'th' ? 'th' : 'en';
    syncSidebar();
    applyLanguage();
  }

  function toggleLanguage() {
    document.documentElement.lang = document.documentElement.lang === 'th' ? 'en' : 'th';
    localStorage.setItem('hktutor-prototype-language', document.documentElement.lang);
    applyLanguage();
  }

  function applyLanguage() {
    const th = document.documentElement.lang === 'th';
    document.querySelectorAll('[data-en]').forEach((element) => {
      if (element.children.length === 0)
        element.textContent = th ? element.dataset.th : element.dataset.en;
    });
    document.querySelectorAll('[data-ph-en]').forEach((element) => {
      element.placeholder = th ? element.dataset.phTh : element.dataset.phEn;
    });
    const label = document.querySelector('.dash-lang-label');
    if (label) label.textContent = th ? 'TH' : 'EN';
    const button = document.querySelector('.dash-lang-btn');
    if (button) {
      button.setAttribute('aria-pressed', String(th));
      button.setAttribute(
        'aria-label',
        th ? 'เปลี่ยนภาษาเป็นภาษาอังกฤษ' : 'Switch language to Thai',
      );
    }
  }

  function toast(en, th) {
    const element = document.querySelector('.proto-toast');
    if (!element) return;
    element.textContent = document.documentElement.lang === 'th' ? th : en;
    element.classList.add('show');
    window.setTimeout(() => element.classList.remove('show'), 2200);
  }

  window.HKTutorPrototype = { mount, applyLanguage, toast };
})();
