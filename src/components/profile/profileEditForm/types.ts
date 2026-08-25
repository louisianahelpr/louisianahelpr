import type { Database } from "@/integrations/supabase/types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export interface ProfileEditFormProps {
  profile: Profile | null;
  firstName: string;
  lastName: string;
  phone: string;
  setPhone: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  zipCode: string;
  setZipCode: (v: string) => void;
  bio: string;
  setBio: (v: string) => void;
  initials: string;
  avatarBroken: boolean;
  setAvatarBroken: (v: boolean) => void;
  avatarUploading: boolean;
  idUploading: boolean;
  saving: boolean;
  justSaved: boolean;
  onSave: (e: React.FormEvent) => void;
  onAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onIdUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBack: () => void;
  /** Called after portfolio upload/remove with the full new URL list so
   *  the parent can sync its profile state without a refetch. */
  onPortfolioChange?: (urls: string[]) => void;
  /** Called after an intro-video upload/remove with the three column values
   *  so the parent can sync its profile state without a refetch. */
  onIntroVideoChange?: (fields: {
    intro_video_url: string | null;
    intro_video_thumbnail_url: string | null;
    intro_video_duration_seconds: number | null;
  }) => void;
}
