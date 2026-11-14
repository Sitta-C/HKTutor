# UI consistency fix evidence

Browser screenshots captured on 2026-11-14 for `fix/ui-consistency`. Before images use the PR base
`d0fd58e`; report/review after images use `58bc10c`. Both versions use identical synthetic API
fixtures at a 1440 px viewport. After images also cover 320 px. The review sheet deliberately limits
its reading width, so the before/after component crops have different widths.

All API requests in the screenshot previews are intercepted. Names, reviews, booking counts,
revenue and coupon limits are test fixtures. These images do not demonstrate a real payment or
modify Supabase records. The development indicator is hidden in report previews; component crops
exclude surrounding page chrome. Confirmation examples come from the branch's browser validation.

| Image                                                       | What it demonstrates                                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Report before](report-before-1440.png)                     | Separate metric cards and status badges with equal visual weight.                                        |
| [Report after](report-after-1440.png)                       | Teaching ledger, explicit completion denominator, CSV/print actions, loaded time and metric definitions. |
| [Report at 320 px](report-after-320.png)                    | Stacked outcomes/status ledger and readable definitions in the dashboard shell.                          |
| [Reviews before](reviews-before-1440.png)                   | Author, overall score and three criterion scores compete with the feedback.                              |
| [Reviews after](reviews-after-1440.png)                     | Score margin, feedback first, attribution below and optional criterion details.                          |
| [Reviews at 320 px](reviews-after-320.png)                  | The same reading order fits narrow screens.                                                              |
| [Pending requests](pending-requests-after.png)              | Tutor booking navigation shows the fixture's three pending requests.                                     |
| [Attendance confirmation](attendance-confirmation-1440.png) | Selected outcome and finality appear before the attendance write.                                        |
| [Payment confirmation](payment-confirmation-1440.png)       | A test QR is described as payment preparation, with amount/course/time shown before submission.          |
| [Coupon capacity](coupon-capacity-1440.png)                 | Current total 100, used 12, reserved 3, desired total 150 and 50 additional uses.                        |
| [Coupon capacity at 320 px](coupon-capacity-320.png)        | Editable quota confirmation keeps the summary, input and actions readable.                               |

The report fixture contains 12 bookings: 3 pending, 1 confirmed, 6 completed, 2 canceled and 0 expired.
Its net teaching revenue is THB 905.00 and completion rate is 6 / (6 + 2) = 75%. These are summary
exports, not per-booking transaction exports or payout records.
