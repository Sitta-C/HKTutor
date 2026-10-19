export type UserRole = 'STUDENT' | 'TUTOR' | 'ADMIN';

export interface Avatar {
  url: string;
  expiresAt: string;
  updatedAt: string;
}

export interface AvatarReadResponse {
  avatar: Avatar | null;
}

export interface AvatarMutationResponse {
  avatarUpdatedAt: string | null;
}

export type QualificationDocumentType = 'DEGREE' | 'CERTIFICATE';
export type QualificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface QualificationUploadResponse {
  documentId: string;
  status: QualificationStatus;
  fileName: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  size: number;
  createdAt: string;
}

export interface QualificationDocument extends QualificationUploadResponse {
  type: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export interface QualificationListResponse {
  items: Pick<
    QualificationDocument,
    'documentId' | 'type' | 'status' | 'reviewedAt' | 'rejectionReason'
  >[];
}

export interface QualificationTutor {
  userId: string;
  displayName: string;
  verificationStatus: TutorProfile['verificationStatus'];
}

export interface QualificationQueueResponse {
  items: (QualificationDocument & { tutor: QualificationTutor })[];
  nextCursor: string | null;
}

export interface QualificationDetailResponse {
  document: QualificationDocument;
  tutor: QualificationTutor;
  reviewHistory: {
    status: QualificationStatus;
    reviewedBy: string;
    reviewedAt: string;
    reason: string | null;
  }[];
}

export interface QualificationSignedUrlResponse {
  url: string;
  expiresAt: string;
}

export type ReviewQualificationPayload =
  { decision: 'APPROVED'; reason?: string } | { decision: 'REJECTED'; reason: string };

export interface QualificationReviewResponse {
  documentId: string;
  status: 'APPROVED' | 'REJECTED';
  reviewedAt: string;
  reviewedBy: string;
  tutorVerificationStatus: TutorProfile['verificationStatus'];
}

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
  verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
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
  avatarUpdatedAt?: string | null;
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

export type TutorRankingPriority = 'lowest_price' | 'highest_rating' | 'earliest_availability';

export type TutorRecommendationTag =
  'FITS_BUDGET' | 'LOWEST_PRICE' | 'HIGHEST_RATED' | 'EARLIEST_AVAILABILITY';

export interface TutorSearchQuery {
  priority?: TutorRankingPriority;
  subject?: string;
  grade?: string;
  maxPrice?: number;
  minimumRating?: number;
  page?: number;
  pageSize?: number;
}

export interface TutorSearchResult {
  recommendationTags: TutorRecommendationTag[];
  avatarUpdatedAt?: string | null;
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
  verificationStatus: 'VERIFIED';
  nextAvailableAt: string | null;
}

export interface TutorSearchResponse {
  items: TutorSearchResult[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PublicTutorProfile {
  avatarUpdatedAt?: string | null;
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
  verificationStatus?: 'VERIFIED';
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

export type PaymentStatus = 'UNPAID' | 'PAID';

export interface PromptPayPayment {
  bookingId: string;
  paymentStatus: PaymentStatus;
  paymentPending: boolean;
  paidAt: string | null;
  reference: string | null;
  attempt: {
    id: string;
    status: 'CREATING' | 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'EXPIRED';
    amount: string;
    currency: string;
    chargeId: string | null;
    qrCodeUrl: string | null;
    expiresAt: string | null;
    failureCode: string | null;
  } | null;
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
  paymentStatus: PaymentStatus;
  paidAt: string | null;
  mockReference: string | null;
  paymentReference?: string | null;
  paymentPending?: boolean;
  createdAt: string;
}

export interface BookingDetail extends BookingView {
  updatedAt: string;
}

export interface BookingClassDetails {
  bookingId: string;
  status: BookingStatus;
  startAt: string;
  endAt: string;
  subject: { id: string; name: string };
  meetingUrl: string | null;
  attendance: 'ATTENDED' | 'ABSENT' | null;
  attendanceMarkedAt: string | null;
  participants: {
    tutor: { id: string; detail: { displayName: string } };
    student: { id: string; detail: { firstName: string; lastName: string; nickname: string } };
  };
}

export type AttendanceStatus = 'ATTENDED' | 'ABSENT';

export interface SavedAttendanceSummary {
  bookingId: string;
  attendance: AttendanceStatus;
  attendanceMarkedAt: string;
  idempotentReplay: boolean;
  status: BookingStatus;
}

export interface BookingMeetingLink {
  bookingId: string;
  meetingUrl: string | null;
  updatedAt: string;
}

export interface CancelBookingResult {
  bookingId: string;
  status: BookingStatus;
  canceledAt: string;
}

export interface MyBookingsResponse {
  items: BookingView[];
  total: number;
}

export interface MyBookingsQuery {
  status?: BookingStatus;
  from?: string | Date;
  to?: string | Date;
  page?: number;
  pageSize?: number;
}

export interface TutorBookingView {
  id: string;
  status: BookingStatus;
  student: { nickname: string | null };
  listing: BookingQuoteListing;
  slot: BookingQuoteSlot;
  subtotalAmount: string;
  discountAmount: string;
  netAmount: string;
  currency: string;
  createdAt: string;
}

export interface TutorBookingsResponse {
  items: TutorBookingView[];
  total: number;
}

export type TutorBookingsQuery = MyBookingsQuery;

/** Whether the acted-on booking still reserves its availability slot. */
export type BookingSlotStatus = 'AVAILABLE' | 'RESERVED';

export interface ConfirmTutorBookingPayload {
  note?: string;
}

export interface RejectTutorBookingPayload {
  reason?: string;
}

export interface TutorBookingActionResult {
  bookingId: string;
  status: BookingStatus;
  slotStatus: BookingSlotStatus;
  canceledAt: string | null;
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
  rangeMode?: 'overlap';
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

export interface ConversationSummary {
  conversationId: string;
  createdAt: string;
  otherParticipant: { userId: string; displayName: string };
  lastMessage: { messageId: string; senderId: string; text: string; sentAt: string } | null;
  unreadCount: number;
}

export interface ConversationListResponse {
  items: ConversationSummary[];
  nextCursor: string | null;
}

export interface OpenConversationResponse {
  conversationId: string;
  participants: { userId: string; role: 'STUDENT' | 'TUTOR' }[];
  createdAt: string;
}

export interface ConversationMessage {
  messageId: string;
  conversationId: string;
  senderId: string;
  text: string;
  sentAt: string;
  readAt: string | null;
}

export interface ConversationMessagesResponse {
  items: ConversationMessage[];
  nextAfterMessageId: string | null;
  nextBeforeMessageId?: string | null;
  hasMore: boolean;
}

export type RescheduleRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

export type RescheduleAction = 'CREATE' | 'APPROVE' | 'REJECT' | 'WITHDRAW';

export interface CreateRescheduleRequestPayload {
  targetSlotId: string;
  reason?: string;
}

export interface CreateRescheduleRequestResponse {
  requestId: string;
  status: 'PENDING';
  bookingId: string;
  targetSlotId: string;
}

export interface RescheduleTargetSlot {
  id: string;
  startAtUtc: string;
  endAtUtc: string;
  tutorProfileId: string;
}

export interface RescheduleRequestView {
  id: string;
  bookingId: string;
  requestedById: string;
  fromSlotId: string;
  requestedSlotId: string;
  reason: string;
  status: RescheduleRequestStatus;
  requestedAt: string;
  reviewedById: string | null;
  decidedAt: string | null;
  withdrawnAt: string | null;
}

export interface CurrentRescheduleRequestResponse {
  request: RescheduleRequestView | null;
  targetSlot: RescheduleTargetSlot | null;
  allowedActions: RescheduleAction[];
}

export interface ApprovedRescheduleBooking {
  id: string;
  status: BookingStatus;
  slotId: string;
  studentUserId: string;
  tutorProfileId: string;
  listingId: string;
  subtotalAmount: string;
  netAmount: string;
  updatedAt: string;
}

export interface ApproveRescheduleResponse {
  requestId: string;
  status: 'APPROVED';
  booking: ApprovedRescheduleBooking;
  newSlot: RescheduleTargetSlot;
}

export interface RejectReschedulePayload {
  reason?: string;
}

export interface RejectRescheduleResponse {
  requestId: string;
  status: 'REJECTED';
  reviewedAt: string;
}

export interface WithdrawRescheduleResponse {
  requestId: string;
  status: 'WITHDRAWN';
  withdrawnAt: string;
}

export interface ResetPasswordPayload {
  token: string;
  password: string;
}

export type EmailFlowPurpose = 'verification' | 'password-reset';

export interface EmailFlow {
  id: string;
  email: string;
  purpose: EmailFlowPurpose;
  resendAvailableAt: string;
  retryAfterSeconds: number;
}

export interface EmailRequestResponse {
  message: string;
  emailFlow: EmailFlow;
}

export interface InboxNotification {
  id: string;
  eventType: string;
  title: string;
  bookingId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: InboxNotification[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface NotificationsQuery {
  cursor?: string;
  limit?: number;
  unreadOnly?: boolean;
}

export interface NotificationReadReceipt {
  id: string;
  readAt: string;
}

export interface NotificationsReadAllResult {
  updatedCount: number;
  readAt: string | null;
}
