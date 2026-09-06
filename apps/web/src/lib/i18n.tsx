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
      policyAfter: ' (version {version}), including the processing of my sign-in details by Clerk.',
      policyRequired:
        'You must accept the privacy notice before an HKTutor account can be created.',
      submit: 'Create account',
      loading: 'Creating account...',
      already: 'Already have an account?',
      signIn: 'Sign in',
      passwordMismatch: 'Passwords do not match',
      otpEyebrow: 'Verify your email',
      otpTitle: 'Enter verification code',
      otpSubtitle:
        'We sent a verification code to {email}. Enter the code below to finish signing up.',
      otpLabel: 'Verification code',
      otpPlaceholder: 'Enter verification code',
      otpSubmit: 'Verify email',
      otpLoading: 'Verifying...',
      otpResendPrompt: "Didn't receive the code?",
      otpResend: 'Resend code',
      otpResending: 'Resending...',
      otpResent: 'Verification code resent!',
      otpBack: 'Change email',
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
      policyAfter: ' (เวอร์ชัน {version}) รวมถึงการที่ Clerk ประมวลผลข้อมูลการเข้าสู่ระบบของฉัน',
      policyRequired: 'คุณต้องยอมรับประกาศความเป็นส่วนตัวก่อนจึงจะสร้างบัญชี HKTutor ได้',
      submit: 'สร้างบัญชี',
      loading: 'กำลังสร้างบัญชี...',
      already: 'มีบัญชีอยู่แล้ว?',
      signIn: 'เข้าสู่ระบบ',
      passwordMismatch: 'รหัสผ่านไม่ตรงกัน',
      otpEyebrow: 'ยืนยันอีเมลของคุณ',
      otpTitle: 'กรอกรหัสยืนยัน',
      otpSubtitle:
        'เราได้ส่งรหัสยืนยันไปยัง {email} กรุณากรอกรหัสด้านล่างเพื่อเสร็จสิ้นการสมัครสมาชิก',
      otpLabel: 'รหัสยืนยัน',
      otpPlaceholder: 'กรอกรหัสยืนยัน',
      otpSubmit: 'ยืนยันอีเมล',
      otpLoading: 'กำลังยืนยัน...',
      otpResendPrompt: 'ไม่ได้รับรหัส?',
      otpResend: 'ส่งรหัสอีกครั้ง',
      otpResending: 'กำลังส่งรหัสอีกครั้ง...',
      otpResent: 'ส่งรหัสยืนยันใหม่แล้ว!',
      otpBack: 'เปลี่ยนอีเมล',
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
