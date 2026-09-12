'use client';

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';

import type { ReactNode } from 'react';

export type Language = 'en' | 'th';

const LANGUAGE_STORAGE_KEY = 'hktutor-language';
let currentLanguage: Language = 'en';
let hasLoadedLanguage = false;
const languageListeners = new Set<() => void>();

function readStoredLanguage() {
  if (typeof window === 'undefined') return 'en' as Language;
  if (hasLoadedLanguage) return currentLanguage;

  try {
    const savedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (savedLanguage === 'en' || savedLanguage === 'th') {
      currentLanguage = savedLanguage;
    }
  } catch {
    // Keep English when local storage is unavailable.
  }

  hasLoadedLanguage = true;
  return currentLanguage;
}

function subscribeToLanguage(callback: () => void) {
  languageListeners.add(callback);
  window.addEventListener('storage', handleStorageChange);

  return () => {
    languageListeners.delete(callback);
    window.removeEventListener('storage', handleStorageChange);
  };
}

function handleStorageChange(event: StorageEvent) {
  if (event.key !== LANGUAGE_STORAGE_KEY) return;

  hasLoadedLanguage = false;
  languageListeners.forEach((listener) => listener());
}

function saveLanguage(language: Language) {
  currentLanguage = language;
  hasLoadedLanguage = true;

  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The language still works for this session when storage is unavailable.
  }

  languageListeners.forEach((listener) => listener());
}

function getServerLanguage(): Language {
  return 'en';
}

const translations = {
  en: {
    common: {
      languageButtonLabel: 'Switch language to Thai',
      copyright: 'HKTutor',
      privacySupport: 'Privacy & support',
    },
    shell: {
      login: {
        secondary: 'Learn with us',
        nav: 'Sign up',
        cta: 'Get started',
      },
      register: {
        secondary: 'Back to sign in',
        nav: 'Sign in',
        cta: 'Return to login',
      },
    },
    social: {
      dividerLogin: 'Or sign in with',
      dividerRegister: 'Or continue with',
      google: 'Google',
      apple: 'Apple',
      facebook: 'Facebook',
      googleAria: 'Continue with Google',
      appleAria: 'Continue with Apple',
      facebookAria: 'Continue with Facebook',
    },
    login: {
      eyebrow: 'Student portal',
      title: 'Welcome back',
      subtitle: 'Enter your details to continue your learning journey.',
      emailLabel: 'Email address',
      emailPlaceholder: 'Email address',
      passwordLabel: 'Password',
      passwordPlaceholder: 'Password',
      showPassword: 'Show password',
      hidePassword: 'Hide password',
      trouble: 'Having trouble signing in?',
      submit: 'Sign in',
      loading: 'Signing in...',
      newTo: 'New to HKTutor?',
      createAccount: 'Create an account',
    },
    register: {
      eyebrow: 'Join HKTutor',
      title: 'Start your learning journey',
      subtitle: 'Create an account and find the right space to grow.',
      emailLabel: 'Email address',
      emailPlaceholder: 'Email address',
      passwordLabel: 'Password',
      passwordPlaceholder: 'Create a password',
      confirmPasswordLabel: 'Confirm password',
      confirmPasswordPlaceholder: 'Confirm your password',
      showPassword: 'Show password',
      hidePassword: 'Hide password',
      showConfirmPassword: 'Show confirm password',
      hideConfirmPassword: 'Hide confirm password',
      joiningAs: "I'm joining as",
      chooseRole: 'Choose your role',
      student: 'Student',
      tutor: 'Tutor',
      policyBefore: 'I have read and accept the',
      policyLink: 'HKTutor privacy notice',
      policyAfter:
        ' (version {version}), including account, profile, education, emergency contact, security, and verification email processing.',
      policyRequired:
        'You must accept the privacy notice before an HKTutor account can be created.',
      submit: 'Create account',
      loading: 'Creating account...',
      already: 'Already have an account?',
      signIn: 'Sign in',
      passwordMismatch: 'Passwords do not match',
      otpEyebrow: 'Verify your email',
      otpTitle: 'Check your inbox',
      otpSubtitle: 'We sent a verification link to {email}. Open it to finish signing up.',
      otpLabel: 'Verification link',
      otpPlaceholder: 'Open the link from your email',
      otpSubmit: 'Verify email',
      otpLoading: 'Verifying...',
      otpResendPrompt: "Didn't receive the email?",
      otpResend: 'Resend email',
      otpResending: 'Resending...',
      otpResent: 'Verification email resent!',
      otpBack: 'Change email',
      verificationSuccess: 'Email verified. Redirecting you to complete your profile…',
      verificationReturningToOriginalTab: 'Email verified. Returning to your original tab…',
      verificationCloseTab:
        'Email verified. Your original tab is ready; you can close this tab manually.',
      closeVerificationTab: 'Close this tab',
      verificationFailed: 'Verification failed',
      resendFailed: 'Could not resend verification email',
    },
    aboutMe: {
      eyebrow: 'About HKTutor',
      title: 'Learn at your own pace.',
      subtitle:
        'HKTutor is a simple space for students and tutors to learn, share, and make progress together.',
      nav: 'Why HKTutor',
      sectionEyebrow: 'Our approach',
      sectionTitle: 'Made for real learning.',
      sectionBody:
        'The right support can make learning feel clearer. HKTutor keeps the experience focused on people, goals, and progress.',
      missionTitle: 'A clear place to start',
      missionBody: 'Choose what you want to learn, set a direction, and start from there.',
      studentTitle: 'For students',
      studentBody: 'Find a tutor who fits your subject, goals, and schedule.',
      tutorTitle: 'For tutors',
      tutorBody: 'Share what you know with students who are ready to learn.',
      back: 'Back to sign in',
      cta: 'Get started',
    },
    dashboard: {
      sidebar: {
        closeSidebar: 'Close sidebar',
        openSidebar: 'Open sidebar',
        needHelpTitle: 'Need help?',
        needHelpBody: 'Read how HKTutor handles your data, or reach support anytime.',
        privacyNoticeLink: 'Privacy notice',
      },
      header: {
        findTutorCta: 'Find a tutor',
        myBookingsNav: 'My bookings',
        myListingsNav: 'My listings',
        newListingCta: 'New listing',
        notifications: 'Notifications',
        notificationClose: 'Close notifications',
        notificationNow: 'Just now',
        notificationsUnread: '{count} unread',
        markAllNotificationsRead: 'Mark all as read',
        noNotifications: 'You’re all caught up.',
        profileNotificationTitle: 'Keep your profile up to date',
        profileNotificationBody: 'A clear profile helps students know how you can help.',
        listingNotificationTitle: 'Create your first listing',
        listingNotificationBody: 'Publish a lesson to start receiving booking requests.',
        privacyNotificationTitle: 'Review your privacy settings',
        privacyNotificationBody: 'Check what information is public or private on your profile.',
      },
      nav: {
        myProfile: 'My profile',
        myBookings: 'My bookings',
        myListings: 'My listings',
        availability: 'Availability',
        settings: 'Settings',
        support: 'Support',
        privacy: 'Privacy',
        signOut: 'Sign out',
      },
      common: {
        eyebrow: 'Dashboard',
        welcomeBack: 'Welcome back, {name}',
        studentChip: 'Student',
        tutorChip: 'Tutor',
        adminChip: 'Administrator',
        loading: 'Loading dashboard…',
        bangkokTime: 'Bangkok time',
        bangkokTimeWithZone: 'Bangkok time (UTC+7)',
        comingSoonBadge: 'Coming soon',
        domainApiNotice:
          'Domain APIs in progress (Sprint 1). Booking features will connect when merged.',
        copyright: 'HKTutor. All rights reserved.',
        privacySupport: 'Privacy & Support',
      },
      student: {
        subtitle: "Here's what's coming up in your learning journey.",
        nextLesson: 'Next lesson',
        noUpcomingLessons: 'No upcoming lessons scheduled.',
        confirmedBangkokTime: 'CONFIRMED · Bangkok time',
        bookings: 'Bookings',
        upcomingLessonsCount: 'Upcoming lessons',
        completedLessons: 'completed',
        awaitingConfirmation: 'awaiting confirmation',
        doneBadge: 'DONE',
        pendingBadge: 'PENDING',
        quickActions: 'Quick actions',
        findTutorAction: 'Find a tutor',
        myBookingsAction: 'My bookings',
        accountAction: 'Account',
        waitingOnTutor: 'Waiting on tutor',
        noWaitingRequests: 'No pending requests awaiting tutor reply.',
        yourTutors: 'Your tutors',
        searchPlaceholder: 'Search tutor or subject…',
        findNewTutor: 'Find new tutor',
        noTutorsYetTitle: "You haven't booked any tutors yet.",
        noTutorsYetDescription:
          'Find a tutor who matches your learning goals and book your first lesson.',
        browseAllTutors: 'Browse all tutors',
        cantFindTutor: 'Looking for a tutor?',
        cantFindTutorSub: 'Search all published & verified tutors',
      },
      tutor: {
        subtitle: "Here's what's happening with your teaching this week.",
        nextSession: 'Next session',
        noUpcomingSessions: 'No upcoming sessions scheduled.',
        requests: 'Requests',
        awaitingYourReply: 'Awaiting your reply',
        noRequestsYet: 'No booking requests awaiting reply.',
        thisWeekCount: 'this week',
        rescheduleCount: 'reschedule',
        reviewBadge: 'REVIEW',
        pendingBadge: 'PENDING',
        earnings: 'Earnings',
        thisMonth: 'this month',
        sessionsDoneZero: '0 sessions done',
        paidBadge: 'PAID',
        profileStrength: 'Profile strength',
        quickActions: 'Quick actions',
        newListingAction: 'New listing',
        openSlotsAction: 'Open slots',
        editProfileAction: 'Edit profile',
        bookingRequests: 'Booking requests',
        searchPlaceholder: 'Search student or subject…',
        openCalendar: 'Open calendar',
        noBookingRequestsYet: 'No booking requests awaiting your reply.',
        myListings: 'My listings',
        noListingsYetTitle: "You haven't created any teaching listings yet.",
        noListingsYetDescription:
          'Create a listing for subjects you teach to start receiving student bookings.',
        publishedBadge: 'PUBLISHED',
        draftBadge: 'DRAFT',
        todayBangkokTime: 'Today · Bangkok time',
        manageAvailability: 'Manage availability',
        noSlotsToday: 'No availability slots scheduled for today.',
        decline: 'Decline',
        confirm: 'Confirm',
      },
      availability: {
        eyebrow: 'Tutor availability',
        title: 'Plan your teaching time',
        subtitle: 'Add future time ranges in Bangkok time. HKTutor stores them in UTC.',
        timezone: 'Asia/Bangkok · UTC+7',
        previousWeek: 'Previous week',
        nextWeek: 'Next week',
        today: 'Today',
        weekOf: 'Week of {date}',
        addTitle: 'Add available time',
        addDescription: 'Create one date and time range at a time.',
        date: 'Date',
        startTime: 'Start time',
        endTime: 'End time',
        preview: 'Bangkok preview',
        storedAs: 'Stored as {start}–{end} UTC',
        add: 'Add time',
        adding: 'Adding...',
        reset: 'Reset',
        open: 'OPEN',
        reserved: 'RESERVED',
        delete: 'Delete',
        reservedAction: 'Reserved',
        duration: '{hours} hours',
        noSlots: 'No availability slots for this week.',
        loading: 'Loading availability...',
        loadError: 'Could not load availability. Try again.',
        retry: 'Try again',
        endAfterStart: 'End time must be later than start time.',
        futureRequired: 'Choose a future date and time.',
        createError: 'Could not add this time range.',
        overlapError: 'This time overlaps an existing slot.',
        deleteError: 'Could not delete this slot.',
        reservedError: 'Reserved slots cannot be deleted.',
        added: 'Available time added.',
        deleted: 'Available time deleted.',
        reservedHelp: 'A pending or confirmed booking is using this time.',
        emptyForm: 'Choose a Bangkok date and time range.',
      },
      admin: {
        eyebrow: 'Administrator portal',
        title: 'Administrative account',
        notice:
          'The administrative console is maintained separately from student and tutor workflows. Please sign out or access the dedicated administration tools.',
        signOutButton: 'Sign out of admin session',
        privacyButton: 'Privacy notice',
      },
    },
  },
  th: {
    common: {
      languageButtonLabel: 'เปลี่ยนภาษาเป็นภาษาอังกฤษ',
      copyright: 'HKTutor',
      privacySupport: 'ความเป็นส่วนตัวและการช่วยเหลือ',
    },
    shell: {
      login: {
        secondary: 'เรียนรู้ไปกับเรา',
        nav: 'สมัครสมาชิก',
        cta: 'เริ่มต้นใช้งาน',
      },
      register: {
        secondary: 'กลับไปเข้าสู่ระบบ',
        nav: 'เข้าสู่ระบบ',
        cta: 'กลับไปหน้าเข้าสู่ระบบ',
      },
    },
    social: {
      dividerLogin: 'หรือเข้าสู่ระบบด้วย',
      dividerRegister: 'หรือดำเนินการต่อด้วย',
      google: 'Google',
      apple: 'Apple',
      facebook: 'Facebook',
      googleAria: 'ดำเนินการต่อด้วย Google',
      appleAria: 'ดำเนินการต่อด้วย Apple',
      facebookAria: 'ดำเนินการต่อด้วย Facebook',
    },
    login: {
      eyebrow: 'พื้นที่สำหรับนักเรียน',
      title: 'ยินดีต้อนรับกลับมา',
      subtitle: 'กรอกรายละเอียดของคุณเพื่อเรียนรู้ต่อ',
      emailLabel: 'อีเมล',
      emailPlaceholder: 'อีเมล',
      passwordLabel: 'รหัสผ่าน',
      passwordPlaceholder: 'รหัสผ่าน',
      showPassword: 'แสดงรหัสผ่าน',
      hidePassword: 'ซ่อนรหัสผ่าน',
      trouble: 'มีปัญหาในการเข้าสู่ระบบใช่ไหม?',
      submit: 'เข้าสู่ระบบ',
      loading: 'กำลังเข้าสู่ระบบ...',
      newTo: 'ยังไม่มีบัญชี HKTutor?',
      createAccount: 'สร้างบัญชี',
    },
    register: {
      eyebrow: 'เข้าร่วม HKTutor',
      title: 'เริ่มต้นเส้นทางการเรียนรู้ของคุณ',
      subtitle: 'สร้างบัญชีและเลือกพื้นที่ที่เหมาะกับการเติบโตของคุณ',
      emailLabel: 'อีเมล',
      emailPlaceholder: 'อีเมล',
      passwordLabel: 'รหัสผ่าน',
      passwordPlaceholder: 'สร้างรหัสผ่าน',
      confirmPasswordLabel: 'ยืนยันรหัสผ่าน',
      confirmPasswordPlaceholder: 'ยืนยันรหัสผ่านอีกครั้ง',
      showPassword: 'แสดงรหัสผ่าน',
      hidePassword: 'ซ่อนรหัสผ่าน',
      showConfirmPassword: 'แสดงรหัสผ่านยืนยัน',
      hideConfirmPassword: 'ซ่อนรหัสผ่านยืนยัน',
      joiningAs: 'ฉันกำลังสมัครในฐานะ',
      chooseRole: 'เลือกบทบาทของคุณ',
      student: 'นักเรียน',
      tutor: 'ติวเตอร์',
      policyBefore: 'ฉันได้อ่านและยอมรับ',
      policyLink: 'ประกาศความเป็นส่วนตัวของ HKTutor',
      policyAfter:
        ' (เวอร์ชัน {version}) รวมถึงข้อมูลบัญชี โปรไฟล์ การศึกษา เบอร์ติดต่อฉุกเฉิน ความปลอดภัย และการยืนยันอีเมล',
      policyRequired: 'คุณต้องยอมรับประกาศความเป็นส่วนตัวก่อนจึงจะสร้างบัญชี HKTutor ได้',
      submit: 'สร้างบัญชี',
      loading: 'กำลังสร้างบัญชี...',
      already: 'มีบัญชีอยู่แล้ว?',
      signIn: 'เข้าสู่ระบบ',
      passwordMismatch: 'รหัสผ่านไม่ตรงกัน',
      otpEyebrow: 'ยืนยันอีเมลของคุณ',
      otpTitle: 'ตรวจสอบกล่องจดหมาย',
      otpSubtitle: 'เราได้ส่งลิงก์ยืนยันไปยัง {email} กรุณาเปิดลิงก์เพื่อเสร็จสิ้นการสมัครสมาชิก',
      otpLabel: 'ลิงก์ยืนยัน',
      otpPlaceholder: 'เปิดลิงก์จากอีเมลของคุณ',
      otpSubmit: 'ยืนยันอีเมล',
      otpLoading: 'กำลังยืนยัน...',
      otpResendPrompt: 'ไม่ได้รับอีเมล?',
      otpResend: 'ส่งอีเมลอีกครั้ง',
      otpResending: 'กำลังส่งอีเมลอีกครั้ง...',
      otpResent: 'ส่งอีเมลยืนยันใหม่แล้ว!',
      otpBack: 'เปลี่ยนอีเมล',
      verificationSuccess: 'ยืนยันอีเมลสำเร็จ กำลังไปกรอกข้อมูลโปรไฟล์…',
      verificationReturningToOriginalTab: 'ยืนยันอีเมลสำเร็จ กำลังกลับไปยังแท็บเดิม…',
      verificationCloseTab: 'ยืนยันอีเมลสำเร็จ แท็บเดิมพร้อมใช้งานแล้ว คุณสามารถปิดแท็บนี้ได้',
      closeVerificationTab: 'ปิดแท็บนี้',
      verificationFailed: 'ไม่สามารถยืนยันอีเมลได้',
      resendFailed: 'ไม่สามารถส่งอีเมลยืนยันอีกครั้งได้',
    },
    aboutMe: {
      eyebrow: 'เกี่ยวกับ HKTutor',
      title: 'เรียนรู้ในจังหวะของคุณ',
      subtitle:
        'HKTutor คือพื้นที่เรียบง่ายสำหรับนักเรียนและติวเตอร์ในการเรียน แบ่งปัน และพัฒนาไปด้วยกัน',
      nav: 'ทำไมต้อง HKTutor',
      sectionEyebrow: 'แนวคิดของเรา',
      sectionTitle: 'เรียบง่าย และใช้ได้จริง',
      sectionBody:
        'การเรียนที่ดีเริ่มจากการได้เจอคนที่เหมาะกับเป้าหมายของคุณ เราช่วยให้การเริ่มต้นนั้นชัดเจนขึ้น',
      missionTitle: 'เริ่มต้นได้อย่างชัดเจน',
      missionBody: 'เลือกวิชา เป้าหมาย และเวลาที่เหมาะกับคุณ แล้วเริ่มต้นจากตรงนั้น',
      studentTitle: 'สำหรับนักเรียน',
      studentBody: 'ค้นหาติวเตอร์ที่เหมาะกับวิชา เป้าหมาย และเวลาของคุณ',
      tutorTitle: 'สำหรับติวเตอร์',
      tutorBody: 'แบ่งปันสิ่งที่คุณถนัดกับนักเรียนที่พร้อมเรียนรู้',
      back: 'กลับไปเข้าสู่ระบบ',
      cta: 'เริ่มต้นใช้งาน',
    },
    dashboard: {
      sidebar: {
        closeSidebar: 'ปิดแถบข้าง',
        openSidebar: 'เปิดแถบข้าง',
        needHelpTitle: 'ต้องการความช่วยเหลือ?',
        needHelpBody: 'อ่านรายละเอียดการจัดการข้อมูลส่วนบุคคล หรือติดต่อทีมสนับสนุนได้ตลอดเวลา',
        privacyNoticeLink: 'ประกาศความเป็นส่วนตัว',
      },
      header: {
        findTutorCta: 'ค้นหาติวเตอร์',
        myBookingsNav: 'การจองของฉัน',
        myListingsNav: 'คอร์สของฉัน',
        newListingCta: 'สร้างคอร์สใหม่',
        notifications: 'การแจ้งเตือน',
        notificationClose: 'ปิดการแจ้งเตือน',
        notificationNow: 'เมื่อสักครู่นี้',
        notificationsUnread: 'ยังไม่ได้อ่าน {count} รายการ',
        markAllNotificationsRead: 'ทำเครื่องหมายว่าอ่านแล้วทั้งหมด',
        noNotifications: 'ไม่มีการแจ้งเตือนใหม่',
        profileNotificationTitle: 'อัปเดตโปรไฟล์ของคุณ',
        profileNotificationBody: 'โปรไฟล์ที่ชัดเจนช่วยให้นักเรียนรู้ว่าคุณช่วยอะไรได้บ้าง',
        listingNotificationTitle: 'สร้างประกาศสอนแรกของคุณ',
        listingNotificationBody: 'เผยแพร่บทเรียนเพื่อเริ่มรับคำขอจองจากนักเรียน',
        privacyNotificationTitle: 'ตรวจสอบการตั้งค่าความเป็นส่วนตัว',
        privacyNotificationBody: 'ดูว่าข้อมูลใดบนโปรไฟล์เป็นข้อมูลสาธารณะหรือส่วนตัว',
      },
      nav: {
        myProfile: 'โปรไฟล์ของฉัน',
        myBookings: 'การจองของฉัน',
        myListings: 'คอร์สของฉัน',
        availability: 'ตารางว่าง',
        settings: 'การตั้งค่า',
        support: 'ฝ่ายช่วยเหลือ',
        privacy: 'ความเป็นส่วนตัว',
        signOut: 'ออกจากระบบ',
      },
      common: {
        eyebrow: 'แดชบอร์ด',
        welcomeBack: 'ยินดีต้อนรับกลับมา, {name}',
        studentChip: 'นักเรียน',
        tutorChip: 'ติวเตอร์',
        adminChip: 'ผู้ดูแลระบบ',
        loading: 'กำลังโหลดแดชบอร์ด…',
        bangkokTime: 'เวลาตามกรุงเทพฯ',
        bangkokTimeWithZone: 'เวลาตามกรุงเทพฯ (UTC+7)',
        comingSoonBadge: 'เร็ว ๆ นี้',
        domainApiNotice: 'ฟีเจอร์นี้จะเปิดใช้งานเมื่อบริการ API ของ Sprint 1 รวมเข้าสู่ระบบ',
        copyright: 'HKTutor สงวนลิขสิทธิ์',
        privacySupport: 'ความเป็นส่วนตัวและการช่วยเหลือ',
      },
      student: {
        subtitle: 'นี่คือตารางการเรียนรู้ที่กำลังจะมาถึงของคุณ',
        nextLesson: 'บทเรียนถัดไป',
        noUpcomingLessons: 'ยังไม่มีบทเรียนที่กำลังจะมาถึง',
        confirmedBangkokTime: 'ยืนยันแล้ว · เวลาตามกรุงเทพฯ',
        bookings: 'การจอง',
        upcomingLessonsCount: 'บทเรียนที่กำลังจะมาถึง',
        completedLessons: 'เสร็จสิ้นแล้ว',
        awaitingConfirmation: 'กำลังรอยืนยัน',
        doneBadge: 'เสร็จสิ้น',
        pendingBadge: 'รอดำเนินการ',
        quickActions: 'เมนูลัด',
        findTutorAction: 'ค้นหาติวเตอร์',
        myBookingsAction: 'การจองของฉัน',
        accountAction: 'บัญชี',
        waitingOnTutor: 'กำลังรอติวเตอร์',
        noWaitingRequests: 'ไม่มีคำขอที่รอติวเตอร์ตอบรับ',
        yourTutors: 'ติวเตอร์ของคุณ',
        searchPlaceholder: 'ค้นหาติวเตอร์หรือรายวิชา…',
        findNewTutor: 'ค้นหาติวเตอร์ใหม่',
        noTutorsYetTitle: 'คุณยังไม่มีติวเตอร์ที่บันทึกไว้',
        noTutorsYetDescription: 'ค้นหาติวเตอร์ที่ตรงกับเป้าหมายการเรียนของคุณและเริ่มต้นบทเรียนแรก',
        browseAllTutors: 'ดูติวเตอร์ทั้งหมด',
        cantFindTutor: 'กำลังมองหาติวเตอร์ใช่ไหม?',
        cantFindTutorSub: 'ค้นหาติวเตอร์ที่ผ่านการตรวจสอบและเปิดสอนทั้งหมด',
      },
      tutor: {
        subtitle: 'สรุปงานสอนของคุณในสัปดาห์นี้',
        nextSession: 'คาบถัดไป',
        noUpcomingSessions: 'ยังไม่มีคาบเรียนที่กำลังจะมาถึง',
        requests: 'คำขอจอง',
        awaitingYourReply: 'รอคุณตอบรับ',
        noRequestsYet: 'ไม่มีคำขอจองที่รอการตอบรับ',
        thisWeekCount: 'สัปดาห์นี้',
        rescheduleCount: 'ขอเลื่อนเวลา',
        reviewBadge: 'ต้องตรวจ',
        pendingBadge: 'รอดำเนินการ',
        earnings: 'รายได้',
        thisMonth: 'ในเดือนนี้',
        sessionsDoneZero: 'สอนแล้ว 0 คาบ',
        paidBadge: 'รับแล้ว',
        profileStrength: 'ความสมบูรณ์โปรไฟล์',
        quickActions: 'เมนูลัด',
        newListingAction: 'สร้างคอร์สใหม่',
        openSlotsAction: 'เปิดตารางว่าง',
        editProfileAction: 'แก้ไขโปรไฟล์',
        bookingRequests: 'คำขอจองที่รอตอบ',
        searchPlaceholder: 'ค้นหานักเรียนหรือรายวิชา…',
        openCalendar: 'เปิดปฏิทิน',
        noBookingRequestsYet: 'ไม่มีคำขอจองที่รอการตอบรับ',
        myListings: 'คอร์สของฉัน',
        noListingsYetTitle: 'คุณยังไม่ได้สร้างคอร์สสอน',
        noListingsYetDescription: 'สร้างคอร์สสอนวิชาที่คุณเชี่ยวชาญเพื่อเริ่มรับนักเรียน',
        publishedBadge: 'เผยแพร่แล้ว',
        draftBadge: 'ฉบับร่าง',
        todayBangkokTime: 'วันนี้ · เวลาตามกรุงเทพฯ',
        manageAvailability: 'จัดการตารางว่าง',
        noSlotsToday: 'ไม่มีสล็อตเวลาว่างที่กำหนดไว้สำหรับวันนี้',
        decline: 'ปฏิเสธ',
        confirm: 'ยืนยัน',
      },
      availability: {
        eyebrow: 'ตารางเวลาว่างของติวเตอร์',
        title: 'จัดเวลาสอนของคุณ',
        subtitle: 'เพิ่มช่วงเวลาในอนาคตตามเวลาประเทศไทย ระบบจัดเก็บเป็น UTC',
        timezone: 'เอเชีย/กรุงเทพฯ · UTC+7',
        previousWeek: 'สัปดาห์ก่อนหน้า',
        nextWeek: 'สัปดาห์ถัดไป',
        today: 'วันนี้',
        weekOf: 'สัปดาห์วันที่ {date}',
        addTitle: 'เพิ่มช่วงเวลาว่าง',
        addDescription: 'เพิ่มทีละหนึ่งวันที่และหนึ่งช่วงเวลา',
        date: 'วันที่',
        startTime: 'เวลาเริ่ม',
        endTime: 'เวลาสิ้นสุด',
        preview: 'ตัวอย่างเวลาตามกรุงเทพฯ',
        storedAs: 'จัดเก็บเป็น {start}–{end} UTC',
        add: 'เพิ่มเวลา',
        adding: 'กำลังเพิ่ม...',
        reset: 'รีเซ็ต',
        open: 'ว่าง',
        reserved: 'ถูกจอง',
        delete: 'ลบ',
        reservedAction: 'ถูกจองแล้ว',
        duration: '{hours} ชั่วโมง',
        noSlots: 'ไม่มีช่วงเวลาว่างในสัปดาห์นี้',
        loading: 'กำลังโหลดตารางว่าง...',
        loadError: 'โหลดตารางว่างไม่สำเร็จ กรุณาลองใหม่',
        retry: 'ลองใหม่',
        endAfterStart: 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม',
        futureRequired: 'กรุณาเลือกวันที่และเวลาในอนาคต',
        createError: 'เพิ่มช่วงเวลาไม่สำเร็จ',
        overlapError: 'ช่วงเวลานี้ซ้อนกับช่วงเวลาที่มีอยู่แล้ว',
        deleteError: 'ลบช่วงเวลาไม่สำเร็จ',
        reservedError: 'ไม่สามารถลบช่วงเวลาที่ถูกจองแล้ว',
        added: 'เพิ่มช่วงเวลาว่างแล้ว',
        deleted: 'ลบช่วงเวลาว่างแล้ว',
        reservedHelp: 'ช่วงเวลานี้มีการจองที่รอดำเนินการหรือยืนยันแล้ว',
        emptyForm: 'กรุณาเลือกวันที่และช่วงเวลาตามเวลาประเทศไทย',
      },
      admin: {
        eyebrow: 'ระบบสำหรับผู้ดูแลระบบ',
        title: 'บัญชีผู้ดูแลระบบ',
        notice:
          'หน้าควบคุมสำหรับผู้ดูแลระบบถูกแยกออกจากระบบของนักเรียนและติวเตอร์ กรุณาออกจากระบบหรือเข้าใช้งานผ่านเครื่องมือเฉพาะทาง',
        signOutButton: 'ออกจากระบบผู้ดูแล',
        privacyButton: 'ประกาศความเป็นส่วนตัว',
      },
    },
  },
} as const;

export type Translation = (typeof translations)[Language];

type LanguageContextValue = {
  language: Language;
  copy: Translation;
  toggleLanguage: () => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const language = useSyncExternalStore<Language>(
    subscribeToLanguage,
    readStoredLanguage,
    getServerLanguage,
  );

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(
    () => ({
      language,
      copy: translations[language],
      toggleLanguage: () => saveLanguage(language === 'en' ? 'th' : 'en'),
    }),
    [language],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error('useLanguage must be used inside LanguageProvider');
  }

  return context;
}
