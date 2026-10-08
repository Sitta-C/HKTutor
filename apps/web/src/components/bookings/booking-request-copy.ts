export const bookingRequestCopy = {
  en: {
    reviewDescription: 'Check the course, time and total before sending your request to the tutor.',
    time: 'Requested lesson time',
    verified: 'Verified tutor',
    verificationUnavailable: 'Verification information unavailable',
    hour: 'hour',
    total: 'Request total',
    notice:
      'Wait for the tutor to confirm the lesson time. Check your bookings for the latest status.',
    send: 'Send lesson request',
    back: 'Back',
    sent: 'Lesson request sent',
    loading: 'Loading the course, time and amount…',
    pending: 'Awaiting tutor confirmation',
    confirmed: 'Confirmed',
    completed: 'Completed',
    canceled: 'Canceled',
    expired: 'Expired',
    pendingNotice:
      'Your request is awaiting the tutor’s confirmation. Follow its status in booking details.',
    submittedNotice:
      'Your request has been sent. Check the current status and lesson information in booking details.',
    start: 'Start',
    end: 'End',
    details: 'View booking details',
  },
  th: {
    reviewDescription: 'ตรวจสอบคอร์ส เวลา และยอดเงิน ก่อนส่งคำขอให้ติวเตอร์',
    time: 'เวลาที่ขอเรียน',
    verified: 'ติวเตอร์ผ่านการยืนยันแล้ว',
    verificationUnavailable: 'ไม่มีข้อมูลสถานะการยืนยัน',
    hour: 'ชั่วโมง',
    total: 'ยอดคำขอเรียน',
    notice: 'รอให้ติวเตอร์ยืนยันวันและเวลาเรียน ตรวจสอบสถานะได้ในรายการจองของคุณ',
    send: 'ส่งคำขอเรียน',
    back: 'ย้อนกลับ',
    sent: 'ส่งคำขอเรียนแล้ว',
    loading: 'กำลังโหลดคอร์ส เวลา และยอดเงิน…',
    pending: 'รอติวเตอร์ยืนยัน',
    confirmed: 'ยืนยันแล้ว',
    completed: 'เสร็จสิ้น',
    canceled: 'ยกเลิกแล้ว',
    expired: 'หมดอายุ',
    pendingNotice: 'คำขอของคุณอยู่ระหว่างรอติวเตอร์ยืนยัน ติดตามสถานะได้ที่รายละเอียดการจอง',
    submittedNotice: 'ส่งคำขอแล้ว ตรวจสอบสถานะปัจจุบันและข้อมูลการเรียนได้ที่รายละเอียดการจอง',
    start: 'เริ่ม',
    end: 'จบ',
    details: 'ดูรายละเอียดการจอง',
  },
} as const;

export type BookingRequestCopy = {
  [Key in keyof (typeof bookingRequestCopy)['en']]: string;
};
