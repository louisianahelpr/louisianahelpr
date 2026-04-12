

## Fix: Date and Time fields overlapping on mobile

### Problem
The "Date needed" and "Start time" fields are forced into a 2-column grid (`grid-cols-2`) on all screen sizes. The TimePickerSelect component contains three dropdown selects (hour, minute, AM/PM) that need significant horizontal space, causing them to overflow and overlap on mobile screens.

### Solution
Stack these fields vertically on mobile and only use the 2-column layout on larger screens.

### Changes

**File: `src/pages/PostJob.tsx` (line 568)**
- Change `grid grid-cols-2 gap-4` to `grid grid-cols-1 sm:grid-cols-2 gap-4` for the date/time row

**File: `src/components/activity/EditJobDialog.tsx` (line ~80)**
- Apply the same fix to the Edit Job dialog's date/time grid

**File: `src/components/TimePickerSelect.tsx`**
- Optionally tighten the select widths slightly (e.g. `w-[60px]`) to better fit narrow screens

This is a minimal CSS-only fix — no logic changes needed.

