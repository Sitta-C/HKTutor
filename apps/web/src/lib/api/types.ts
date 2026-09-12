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

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELED' | 'EXPIRED';

export interface CreateBookingPayload {
  listingId: string;
  slotId: string;
}

export interface BookingQuoteTutor {
  tutorId: string;
  displayName: string;
}

export interface BookingQuoteListing {
  id: string;
  subjectId: string;
  subjectName: string;
  gradeLevelId: string;
  gradeLevelName: string;
  pricePerHour: string;
  description: string;
}

export interface BookingQuoteSlot {
  id: string;
  startAtUtc: string;
  endAtUtc: string;
}

export interface BookingQuote {
  tutor: BookingQuoteTutor;
  listing: BookingQuoteListing;
  slot: BookingQuoteSlot;
  subtotalAmount: string;
  discountAmount: string;
  netAmount: string;
  currency: string;
}

export interface BookingResponse {
  id: string;
  status: BookingStatus;
  listingId: string;
  slotId: string;
  subtotalAmount: string;
  discountAmount: string;
  netAmount: string;
  currency: string;
  createdAt: string;
}

export interface BookingView {
  id: string;
  status: BookingStatus;
  tutor: BookingQuoteTutor;
  listing: BookingQuoteListing;
  slot: BookingQuoteSlot;
  subtotalAmount: string;
  discountAmount: string;
  netAmount: string;
  currency: string;
  createdAt: string;
}

export interface BookingDetail extends BookingView {
  updatedAt: string;
}

export interface MyBookingsResponse {
  items: BookingView[];
  total: number;
}

export interface MyBookingsQuery {
  status?: BookingStatus;
  from?: string | Date;
  to?: string | Date;
}
