

## Plan: Profile Page Redesign — Landing Page with Vertical Tab Navigation

### What the user wants
Turn the Profile tab into a **landing/overview page** showing the user's key info at a glance (avatar area, name, stats, quick links). Then move the sub-tabs (Earnings, Schedule, History, Payment, Legal) into a **vertical scrollable list** at the top — like stacked buttons the user taps to navigate into each section.

### Design

The Profile page will have two views:

**1. Landing View (default)** — Shows when no sub-tab is selected:
- Profile header card: initials avatar, full name, role badge, location, email
- Quick stats row: jobs completed, earnings, rating
- Vertical menu list of sections (like a settings page): Edit Profile, Earnings, Schedule, Job History, Payment & Security, Legal & Policies — each as a rounded card row with icon + chevron
- Logout button at bottom

**2. Detail View** — When a menu item is tapped:
- Back arrow returns to landing
- Shows the existing tab content (edit form, earnings, schedule, etc.)

### Technical Changes

**File: `src/pages/Profile.tsx`**
- Change default `tab` state to `"landing"` (new value) 
- Add `"landing"` to the `Tab` type
- Replace the horizontal tab bar with conditional rendering:
  - When `tab === "landing"`: render the landing/overview card + vertical menu
  - When `tab !== "landing"`: render a back button + the selected tab content (reuse existing code)
- Remove the horizontal tab strip entirely
- Add a simple stats section that loads completed job count and average rating from the DB

No database changes needed. Single file edit.

