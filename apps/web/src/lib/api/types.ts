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

export type ListingPublicationStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface SubjectOption {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export interface GradeLevelOption extends SubjectOption {
  sortOrder: number;
}

export interface TeachingListing {
  id: string;
  subject: SubjectOption;
  gradeLevel: GradeLevelOption;
  pricePerHour: number;
  description: string;
  publicationStatus: ListingPublicationStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveTeachingListingPayload {
  subjectId: string;
  gradeLevelId: string;
  pricePerHour: number;
  description: string;
}

export type PatchTeachingListingPayload = {
  [Field in keyof SaveTeachingListingPayload]: Pick<SaveTeachingListingPayload, Field> &
    Partial<Omit<SaveTeachingListingPayload, Field>>;
}[keyof SaveTeachingListingPayload];
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

export interface TutorSearchQuery {
  subject?: string;
  grade?: string;
  maxPrice?: number;
  minimumRating?: number;
}

export interface TutorSearchResult {
  listingId: string;
  tutorId: string;
  displayName: string;
  description: string;
  experienceYears: number;
  subject: string;
  grade: string;
  pricePerHour: number;
  ratingAverage: number | null;
  reviewCount: number;
  nextAvailableAt: string | null;
}

export interface PublicTutorProfile {
  tutorId: string;
  displayName: string;
  bio: string;
  experienceYears: number;
  verificationStatus: 'VERIFIED';
  ratingAverage: number | null;
  reviewCount: number;
}

export interface PublicTeachingListing {
  listingId: string;
  subject: string;
  grade: string;
  pricePerHour: number;
  description: string;
}

export interface PublicTutorDetail {
  tutor: PublicTutorProfile;
  listings: PublicTeachingListing[];
}

export interface PublicAvailabilitySlot {
  id: string;
  startAtUtc: string;
  endAtUtc: string;
}

export interface PublicAvailabilityQuery {
  from?: string | Date;
  to?: string | Date;
}

export type AvailabilityState = 'OPEN' | 'RESERVED';

export interface TutorAvailabilitySlot {
  id: string;
  startAtUtc: string;
  endAtUtc: string;
  createdAt: string;
  state: AvailabilityState;
}

export interface AvailabilityQuery {
  from?: string | Date;
  to?: string | Date;
}

export interface CreateAvailabilityPayload {
  startAt: string;
  endAt: string;
}

export interface CreatedAvailabilitySlot {
  id: string;
  tutorProfileId: string;
  startAtUtc: string;
  endAtUtc: string;
}
