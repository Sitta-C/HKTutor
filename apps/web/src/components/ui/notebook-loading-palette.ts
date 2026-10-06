export const notebookLoadingPalette = {
  dashboardSession: { name: 'Apricot', background: '#ffedd5' },
  tutorDashboard: { name: 'Sky', background: '#dbeafe' },
  studentDashboard: { name: 'Mint', background: '#dcfce7' },
  profileEdit: { name: 'Butter', background: '#fef9c3' },
  profileOnboarding: { name: 'Lavender', background: '#ede9fe' },
  availabilitySession: { name: 'Aqua', background: '#cffafe' },
  listingsSession: { name: 'Sand', background: '#efe3ce' },
  listingCreate: { name: 'Rose', background: '#fce7f3' },
  listingEdit: { name: 'Periwinkle', background: '#dce2ff' },
  bookingsSession: { name: 'Pistachio', background: '#e8edc9' },
  bookingDetailSession: { name: 'Dusty rose', background: '#ecd5df' },
  bookingConfirmSession: { name: 'Lemon', background: '#eef4ba' },
  tutorSearchSession: { name: 'Coral', background: '#ffded8' },
  tutorDetailSession: { name: 'Fog', background: '#e4e8ed' },
} as const;

export type NotebookLoadingKind = keyof typeof notebookLoadingPalette;
