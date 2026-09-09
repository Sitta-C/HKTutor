export type UserRole = 'STUDENT' | 'TUTOR' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  displayName?: string;
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface RegisterPayload {
  email: string;
  password: string;
  role: 'student' | 'tutor';
  consent: boolean;
  policyVersion: string;
}

export interface StudentProfile {
  firstName: string;
  lastName: string;
  nickname: string;
  school: string;
  gradeLevel: string;
  phone: string;
}

export interface TutorProfile {
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  displayName: string;
  bio: string;
  experienceYears: number;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  ratingAverage: string | null;
  reviewCount: number;
}

export interface MyProfileResponse {
  role: UserRole;
  consentCurrent: boolean;
  policyVersion: string;
  profileComplete: boolean;
  profile: StudentProfile | TutorProfile | null;
}

export type SaveStudentProfilePayload = StudentProfile;

export interface SaveTutorProfilePayload {
  firstName: string;
  lastName: string;
  nickname: string;
  displayName: string;
  bio: string;
  experienceYears: number;
}
