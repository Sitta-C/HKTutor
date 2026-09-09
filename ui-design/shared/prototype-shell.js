/* global document, window */

(function () {
  const paths = {
    student: [
      ['profile', '👤', 'My profile', 'โปรไฟล์ของฉัน', '#profile'],
      ['bookings', '📅', 'My bookings', 'การจองของฉัน', 'booking.html', '3'],
      ['settings', '⚙️', 'Settings', 'การตั้งค่า', '#settings'],
      ['support', '🛟', 'Support', 'ฝ่ายช่วยเหลือ', '#support'],
      ['privacy', '🔒', 'Privacy', 'ความเป็นส่วนตัว', '#privacy'],
      ['signout', '↩', 'Sign out', 'ออกจากระบบ', '#signout'],
    ],
    tutor: [
      ['profile', '👤', 'My profile', 'โปรไฟล์ของฉัน', 'tutor-profile.html'],
      ['listings', '📚', 'My listings', 'คอร์สของฉัน', 'listing-form.html', '2'],
      ['availability', '📅', 'Availability', 'ตารางว่าง', 'availability.html'],
      ['settings', '⚙️', 'Settings', 'การตั้งค่า', '#settings'],
      ['support', '🛟', 'Support', 'ฝ่ายช่วยเหลือ', '#support'],
      ['privacy', '🔒', 'Privacy', 'ความเป็นส่วนตัว', '#privacy'],
      ['signout', '↩', 'Sign out', 'ออกจากระบบ', '#signout'],
    ],
  };

  const roleCopy = {
    student: { name: 'Somchai', email: 'student@example.com', initials: 'S' },
    tutor: { name: 'Pim', email: 'pim@example.com', initials: 'P' },
  };

  function copy(en, th, tag = 'span') {
    return `<${tag} data-en="${en}" data-th="${th}">${en}</${tag}>`;
  }

  function navMarkup(role, active) {
    return paths[role]
      .map(([id, icon, en, th, href, count]) => {
        const countMarkup = count ? `<span class="proto-nav-count">${count}</span>` : '';
        const classes = [id === active ? 'active' : '', id === 'signout' ? 'danger' : '']
          .filter(Boolean)
          .join(' ');
        return `<a href="${href}" class="${classes}"><span class="proto-nav-left"><span class="proto-nav-icon" aria-hidden="true">${icon}</span>${copy(en, th)}</span>${countMarkup}</a>`;
      })
      .join('');
  }

  function headerMarkup(config) {
    const actions =
      config.role === 'student'
        ? {
            secondary: ['My bookings', 'การจองของฉัน', 'booking.html#bookings'],
            primary: ['Find a tutor', 'ค้นหาติวเตอร์', 'search.html'],
          }
        : {
            secondary: ['My listings', 'คอร์สของฉัน', 'listing-form.html#listings'],
            primary: ['New listing', 'สร้างคอร์สใหม่', 'listing-form.html#listingForm'],
          };
    const secondary = `<a href="${actions.secondary[2]}">${copy(actions.secondary[0], actions.secondary[1])}</a>`;
    const primary = `<a class="proto-button-amber" href="${actions.primary[2]}">${copy(actions.primary[0], actions.primary[1])}</a>`;
    return `<header class="proto-header"><button type="button" class="proto-reopen proto-logo" aria-label="Open sidebar"><span class="proto-logo-mark">HK</span><span>HKTutor</span></button><nav class="proto-header-nav" aria-label="Page actions"><button class="proto-lang" type="button" aria-label="Switch language" aria-pressed="false"><span class="proto-lang-dot"></span><span class="proto-lang-label">EN</span></button>${secondary}${primary}</nav></header>`;
  }

  function mount(config) {
    const role = config.role === 'student' ? 'student' : 'tutor';
    const user = roleCopy[role];
    document.body.dataset.role = role;
    document.body.classList.toggle(
      'sidebar-collapsed',
      window.matchMedia('(max-width: 960px)').matches,
    );
    const template = document.getElementById('page-content');
    const pageContent = template ? template.innerHTML : '';
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="proto-art" aria-hidden="true"><div class="proto-blob proto-b1"></div><div class="proto-blob proto-b2"></div><div class="proto-blob proto-b3"></div></div>
      <div class="proto-app">
        <aside class="proto-sidebar" aria-label="Dashboard navigation">
          <div class="proto-sidebar-head"><a class="proto-logo" href="${role === 'student' ? 'dashboard-student.html' : 'dashboard-tutor.html'}"><span class="proto-logo-mark">HK</span><span>HKTutor</span></a><button class="proto-icon-button proto-close" type="button" aria-label="Close sidebar">×</button></div>
          <section class="proto-card proto-user-card"><div class="proto-user-chip"><span class="proto-avatar">${user.initials}</span><div class="proto-user-copy"><b>${user.name}</b><span>${user.email}</span></div></div><nav class="proto-side-nav" aria-label="Role navigation">${navMarkup(role, config.active)}</nav></section>
          <section class="proto-card proto-help-card"><h2>${copy('Need help?', 'ต้องการความช่วยเหลือ?')}</h2><p>${copy('Read how HKTutor handles your data, or reach support anytime.', 'อ่านรายละเอียดการจัดการข้อมูลส่วนบุคคล หรือติดต่อฝ่ายช่วยเหลือได้ตลอดเวลา')}</p><a class="proto-text-link" href="#privacy">${copy('Privacy notice', 'ประกาศความเป็นส่วนตัว')}</a></section>
        </aside>
        <div class="proto-main-wrap">${headerMarkup(config)}<main class="proto-main">${pageContent}</main><footer class="proto-footer"><span>© 2026 HKTutor</span><span>|</span>${copy('Privacy & support', 'ความเป็นส่วนตัวและการช่วยเหลือ')}</footer></div>
      </div><div class="proto-toast" role="status" aria-live="polite"></div>`;

    app.querySelector('.proto-close').addEventListener('click', toggleSidebar);
    app.querySelector('.proto-reopen').addEventListener('click', toggleSidebar);
    app.querySelector('.proto-lang').addEventListener('click', toggleLanguage);
    const saved = localStorage.getItem('hktutor-prototype-language');
    document.documentElement.lang = saved === 'th' ? 'th' : 'en';
    applyLanguage();
  }

  function toggleSidebar() {
    document.body.classList.toggle('sidebar-collapsed');
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
    const label = document.querySelector('.proto-lang-label');
    if (label) label.textContent = th ? 'TH' : 'EN';
    const button = document.querySelector('.proto-lang');
    if (button) button.setAttribute('aria-pressed', String(th));
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
